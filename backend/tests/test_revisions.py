"""用真实 WAV 和独立数据库验证编辑失败不会破坏原配音。"""
import io
from unittest.mock import AsyncMock
import numpy as np
import pytest
import soundfile as sf
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend import config
from backend.database import Base, Generation, VoiceProfile, GenerationVersion
from backend.models import EditGenerationRequest
from backend.services import revisions, versions

@pytest.fixture
def ctx(tmp_path, monkeypatch):
    engine = create_engine(f'sqlite:///{tmp_path / "test.db"}')
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    db = factory()
    monkeypatch.setattr(revisions.session, 'SessionLocal', factory)
    monkeypatch.setattr(config, 'get_generations_dir', lambda: tmp_path)
    monkeypatch.setattr(config, 'resolve_storage_path', lambda p: tmp_path / p)
    monkeypatch.setattr(config, 'to_storage_path', lambda p: str(p))
    jobs = []
    monkeypatch.setattr(revisions, 'enqueue_generation', lambda key, coro: jobs.append(coro))
    original = tmp_path / 'original.wav'
    sf.write(original, np.zeros(2400), 24000)
    db.add(VoiceProfile(id='p', name='Demo', voice_type='designed', design_prompt='自然青年'))
    db.add(Generation(id='g', profile_id='p', text='原台词', instruct='平静', language='zh',
                      engine='qwen_voice_design', model_size='1.7B', seed=7,
                      audio_path=str(original), duration=.1, status='completed'))
    db.commit()
    original_version = versions.create_version('g', 'Original', str(original), db, is_default=True)
    yield db, jobs, original, original_version
    for job in jobs: job.close()
    db.close()
    engine.dispose()

@pytest.mark.asyncio
async def test_edit_switches_text_audio_together_and_preserves_original(ctx, monkeypatch):
    db, jobs, original, old = ctx
    before = original.read_bytes()
    buffer = io.BytesIO()
    sf.write(buffer, np.ones(4800) * .1, 24000, format='WAV')
    infer = AsyncMock(return_value=buffer.getvalue())
    monkeypatch.setattr(revisions, 'generate_audio_sync', infer)
    new = revisions.start_revision('g', EditGenerationRequest(text=' 新台词 ', instruct='开心'), db)
    assert db.get(Generation, 'g').text == '原台词'
    assert db.get(Generation, 'g').audio_path == str(original)
    with pytest.raises(ValueError): versions.set_default_version(new.id, db)
    with pytest.raises(HTTPException) as exc:
        revisions.start_revision('g', EditGenerationRequest(text='重复任务'), db)
    assert exc.value.status_code == 409
    await jobs.pop(0)
    db.expire_all()
    gen = db.get(Generation, 'g')
    assert (gen.text, gen.instruct, gen.duration, gen.status) == ('新台词', '开心', .2, 'completed')
    assert gen.audio_path != str(original)
    assert original.read_bytes() == before
    assert infer.call_args.kwargs['seed'] == 7
    assert infer.call_args.kwargs['engine'] == 'qwen_voice_design'
    versions.set_default_version(old.id, db)
    assert (gen.text, gen.instruct, gen.duration, gen.audio_path) == ('原台词', '平静', .1, str(original))
    # 从旧版加效果也必须继承旧稿，不能拿当前新稿误配。
    versions.set_default_version(new.id, db)
    derived = versions.create_version('g', 'Effect', str(original), db, source_version_id=old.id)
    assert derived.text == '原台词'

@pytest.mark.asyncio
async def test_failure_retains_draft_and_original_playable(ctx, monkeypatch):
    db, jobs, original, old = ctx
    monkeypatch.setattr(revisions, 'generate_audio_sync', AsyncMock(side_effect=RuntimeError('模型失败')))
    failed = revisions.start_revision('g', EditGenerationRequest(text='保留草稿', instruct='温柔'), db)
    await jobs.pop(0)
    db.expire_all()
    row = db.get(GenerationVersion, failed.id)
    assert (row.status, row.text, row.instruct, row.error) == ('failed', '保留草稿', '温柔', '模型失败')
    gen = db.get(Generation, 'g')
    assert (gen.text, gen.status, gen.audio_path) == ('原台词', 'completed', str(original))
    assert not versions.delete_version(old.id, db)
    retry = revisions.start_revision('g', EditGenerationRequest(text=row.text), db)
    assert retry.status == 'generating'
    assert versions.delete_version(failed.id, db)
    assert original.is_file()
    versions.delete_versions_for_generation('g', db)
    assert original.parent.is_dir()


def test_old_database_migration_only_snapshots_once(tmp_path):
    # 升级只能首次回填，之后重启不得把旧版台词覆盖成新版。
    from sqlalchemy import inspect, text
    from backend.database.migrations import _migrate_generation_versions
    engine = create_engine(f'sqlite:///{tmp_path / "legacy.db"}')
    with engine.begin() as conn:
        conn.execute(text('CREATE TABLE generations (id TEXT, text TEXT, instruct TEXT, duration FLOAT)'))
        conn.execute(text('CREATE TABLE generation_versions (id TEXT, generation_id TEXT)'))
        conn.execute(text("INSERT INTO generations VALUES ('g', '原台词', '平静', 1.0)"))
        conn.execute(text("INSERT INTO generation_versions VALUES ('v', 'g')"))
    _migrate_generation_versions(engine, inspect(engine), {'generations', 'generation_versions'})
    with engine.begin() as conn:
        assert conn.execute(text('SELECT text, status FROM generation_versions')).one() == ('原台词', 'completed')
        conn.execute(text("UPDATE generations SET text='新台词'"))
    _migrate_generation_versions(engine, inspect(engine), {'generations', 'generation_versions'})
    with engine.connect() as conn:
        assert conn.execute(text('SELECT text FROM generation_versions')).scalar() == '原台词'
    engine.dispose()

@pytest.mark.asyncio
async def test_export_import_preserves_version_transcripts(ctx):
    db, jobs, original, old = ctx
    from backend.services.export_import import export_generation_to_zip, import_generation_from_zip
    edited = original.parent / 'edited.wav'
    edited.write_bytes(original.read_bytes())
    versions.create_version('g', 'Edit', str(edited), db, text='新版台词', instruct='开心', is_default=True)
    # 无音频的失败草稿不会被当作目录导出。
    draft = versions.create_version('g', 'Draft', '', db, text='失败草稿', status='failed')
    package = export_generation_to_zip('g', db)
    imported = await import_generation_from_zip(package, db)
    restored = versions.list_versions(imported['id'], db)
    assert [v.text for v in restored] == ['原台词', '新版台词']
    assert versions.get_default_version(imported['id'], db).text == '新版台词'


def test_restart_recovers_revision_draft(tmp_path, monkeypatch):
    # 重启丢失队列时保留草稿，避免界面永远停在“生成中”。
    from backend.database import session
    monkeypatch.setattr(config, 'get_db_path', lambda: tmp_path / 'restart.db')
    session.init_db()
    db = session.SessionLocal()
    db.add(VoiceProfile(id='p', name='Demo'))
    db.add(Generation(id='g', profile_id='p', text='原文', audio_path='old.wav'))
    db.add(GenerationVersion(id='v', label='Edit', generation_id='g', text='草稿', audio_path='', status='generating'))
    db.commit()
    db.close()
    session.engine.dispose()
    session.init_db()
    db = session.SessionLocal()
    assert db.get(GenerationVersion, 'v').status == 'failed'
    assert db.get(GenerationVersion, 'v').text == '草稿'
    assert db.get(Generation, 'g').text == '原文'
    db.close()
    session.engine.dispose()

@pytest.mark.asyncio
async def test_single_history_poll_returns_revision_state(ctx):
    # 单条刷新是桌面端追踪任务的入口，也必须携带版本快照。
    from backend.routes.history import get_generation
    db, jobs, original, old = ctx
    new = revisions.start_revision('g', EditGenerationRequest(text='轮询稿'), db)
    result = await get_generation('g', db)
    assert result.text == '原台词'
    assert result.versions[-1].id == new.id
    assert result.versions[-1].status == 'generating'
    assert result.versions[-1].text == '轮询稿'

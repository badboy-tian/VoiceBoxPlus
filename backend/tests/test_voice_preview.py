"""验证试音保存生命周期与历史隔离，模型推理用替身以免下载权重。"""
from unittest.mock import AsyncMock

import numpy as np
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend import config
from backend.database import Base, Generation, VoiceProfile
from backend.models import VoiceProfileCreate
from backend.routes.profiles import create_profile, get_profile_preview_audio, update_profile
from backend.services import voice_preview


@pytest.fixture
def context(tmp_path, monkeypatch):
    engine = create_engine(f'sqlite:///{tmp_path / "test.db"}')
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    db = factory()
    monkeypatch.setattr(config, 'get_profiles_dir', lambda: tmp_path / 'profiles')
    monkeypatch.setattr(voice_preview.session, 'SessionLocal', factory)
    jobs = []
    monkeypatch.setattr(voice_preview, 'enqueue_generation', lambda key, coro: jobs.append(coro))
    yield db, jobs
    for job in jobs:
        job.close()
    voice_preview._active.clear()
    db.close()
    engine.dispose()


@pytest.mark.asyncio
async def test_save_generates_dedicated_audio_without_history(context, monkeypatch):
    db, jobs = context
    from backend import backends
    from backend.utils import chunked_tts
    model = object()
    monkeypatch.setattr(backends, 'get_tts_backend_for_engine', lambda _: model)
    monkeypatch.setattr(backends, 'load_engine_model', AsyncMock())
    generate = AsyncMock(return_value=(np.zeros(2400, dtype=np.float32), 24000))
    monkeypatch.setattr(chunked_tts, 'generate_chunked', generate)
    profile = await create_profile(VoiceProfileCreate(
        name='试音', language='zh', voice_type='designed', design_prompt='温柔自然的女声',
    ), db)
    assert profile.preview_status == 'generating'
    # 生成完成前 GET 不触发新任务，更不拿历史内容凑数。
    with pytest.raises(HTTPException) as error:
        await get_profile_preview_audio(profile.id, db)
    assert error.value.status_code == 409
    assert len(jobs) == 1
    await jobs.pop(0)
    row = db.get(VoiceProfile, profile.id)
    state = voice_preview.preview_state(row, db)
    assert state['status'] == 'ready'
    assert generate.call_args.args[1] == voice_preview.TEXT['zh']
    assert db.query(Generation).count() == 0
    response = await get_profile_preview_audio(profile.id, db)
    assert response.path.name == 'preview.wav'
    assert response.path.read_bytes().startswith(b'RIFF')
    assert not jobs
    # 改名不会改变声音，编辑声音配置才生成新版本。
    await update_profile(profile.id, VoiceProfileCreate(name='新名称', language='zh'), db)
    assert not jobs
    await update_profile(profile.id, VoiceProfileCreate(name='新名称', language='en'), db)
    assert len(jobs) == 1
    with pytest.raises(HTTPException):
        await get_profile_preview_audio(profile.id, db)


@pytest.mark.asyncio
async def test_failure_does_not_fall_back_to_old_audio(context, monkeypatch):
    db, jobs = context
    from backend import backends
    monkeypatch.setattr(backends, 'get_tts_backend_for_engine', lambda _: object())
    monkeypatch.setattr(backends, 'load_engine_model', AsyncMock(side_effect=RuntimeError('no model')))
    profile = await create_profile(VoiceProfileCreate(
        name='失败测试', voice_type='designed', design_prompt='自然男声',
    ), db)
    await jobs.pop(0)
    state = voice_preview.preview_state(db.get(VoiceProfile, profile.id), db)
    assert state['status'] == 'failed'
    assert state['error'] == 'no model'
    with pytest.raises(HTTPException):
        await get_profile_preview_audio(profile.id, db)
    voice_preview.schedule_preview(profile.id, db)
    assert len(jobs) == 1


@pytest.mark.asyncio
async def test_custom_text_persists_and_edit_rebuilds_preview(context, monkeypatch):
    db, jobs = context
    from backend import backends
    from backend.utils import chunked_tts
    monkeypatch.setattr(backends, 'get_tts_backend_for_engine', lambda _: object())
    monkeypatch.setattr(backends, 'load_engine_model', AsyncMock())
    generate = AsyncMock(return_value=(np.zeros(2400, dtype=np.float32), 24000))
    monkeypatch.setattr(chunked_tts, 'generate_chunked', generate)
    profile = await create_profile(VoiceProfileCreate(
        name='自定义文案', language='zh', voice_type='designed', design_prompt='自然男声',
        preview_text='  这是保存的自定义试听文案。  ',
    ), db)
    assert profile.preview_text == '这是保存的自定义试听文案。'
    await jobs.pop(0)
    assert generate.call_args.args[1] == profile.preview_text
    previous = voice_preview.preview_state(db.get(VoiceProfile, profile.id), db)['revision']
    updated = await update_profile(profile.id, VoiceProfileCreate(
        name=profile.name, language='zh', preview_text='换一段新的试听文案。',
    ), db)
    assert updated.preview_status == 'generating'
    await jobs.pop(0)
    assert generate.call_args.args[1] == '换一段新的试听文案。'
    assert voice_preview.preview_state(db.get(VoiceProfile, profile.id), db)['revision'] != previous
    # 旧客户端不认识该字段时，不应擦除用户已经保存的内容。
    updated = await update_profile(profile.id, VoiceProfileCreate(name=profile.name, language='zh'), db)
    assert updated.preview_text == '换一段新的试听文案。'
    assert not jobs
    assert db.query(Generation).count() == 0


def test_existing_database_gains_nullable_preview_text(tmp_path):
    from sqlalchemy import inspect, text
    from backend.database.migrations import run_migrations
    engine = create_engine(f'sqlite:///{tmp_path / "legacy.db"}')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT)'))
        connection.execute(text("INSERT INTO profiles VALUES ('old', '原有音色')"))
    # 迁移重复执行仍安全，原档案和默认文案行为保持不变。
    run_migrations(engine)
    run_migrations(engine)
    assert 'preview_text' in {column['name'] for column in inspect(engine).get_columns('profiles')}
    with engine.connect() as connection:
        assert connection.execute(text('SELECT name, preview_text FROM profiles')).one() == ('原有音色', None)
    engine.dispose()

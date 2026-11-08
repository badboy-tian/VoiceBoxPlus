"""台词编辑使用独立版本任务，保护现有可播放记录。"""
import asyncio
import io
import json

import soundfile as sf
from fastapi import HTTPException

from .. import config
from ..database import Generation, GenerationVersion
from ..database import session
from . import versions
from .generation import generate_audio_sync
from .task_queue import enqueue_generation


def start_revision(generation_id, data, db):
    gen = db.get(Generation, generation_id)
    if not gen:
        raise HTTPException(404, 'Generation not found')
    if gen.status != 'completed' or not gen.audio_path:
        raise HTTPException(409, 'Only completed generations can be edited')
    if db.query(GenerationVersion).filter_by(generation_id=generation_id, status='generating').first():
        raise HTTPException(409, 'An edited version is already generating')
    from . import profiles
    from ..database import VoiceProfile
    profile = db.get(VoiceProfile, gen.profile_id)
    if not profile:
        raise HTTPException(404, 'Profile not found')
    try:
        profiles.validate_profile_engine(profile, gen.engine or 'qwen')
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    source = versions.get_default_version(generation_id, db)
    if source is None:
        source = versions.create_version(generation_id, 'Original', gen.audio_path, db, is_default=True)
    # 固定来源与参数，排队期间用户切换版本不会改变此次编辑的含义。
    version = versions.create_version(
        generation_id, f'Edit {len(versions.list_versions(generation_id, db)) + 1}', '', db,
        source_version_id=source.id, text=data.text, instruct=data.instruct,
        effects_chain=[e.model_dump() for e in source.effects_chain] if source.effects_chain else None,
        status='generating',
    )
    job = run_revision(version.id)
    try:
        enqueue_generation(version.id, job)
    except Exception as error:
        job.close()
        row = db.get(GenerationVersion, version.id)
        row.status, row.error = 'failed', str(error)
        db.commit()
        raise HTTPException(503, str(error)) from error
    return version


async def run_revision(version_id):
    db = session.SessionLocal()
    path = None
    try:
        version = db.get(GenerationVersion, version_id)
        if not version:
            return
        gen = db.get(Generation, version.generation_id)
        if not gen:
            return
        wav = await generate_audio_sync(
            profile_id=gen.profile_id, text=version.text, instruct=version.instruct,
            language=gen.language, engine=gen.engine or 'qwen', model_size=gen.model_size,
            seed=gen.seed,
        )
        audio, rate = sf.read(io.BytesIO(wav))
        if version.effects_chain:
            from ..utils.effects import apply_effects
            audio = await asyncio.to_thread(apply_effects, audio, rate, json.loads(version.effects_chain))
        path = config.get_generations_dir() / f'{version.generation_id}_{version.id}.wav'
        await asyncio.to_thread(sf.write, str(path), audio, rate)
        # 推理期间可能删除整条历史；重新查询避免复活已删除的数据。
        db.expire_all()
        version = db.get(GenerationVersion, version_id)
        if not version:
            path.unlink(missing_ok=True)
            return
        version.audio_path = config.to_storage_path(path)
        version.duration = len(audio) / rate
        version.status, version.error = 'completed', None
        versions.set_default_version(version_id, db)
    except (Exception, asyncio.CancelledError) as error:
        db.rollback()
        version = db.get(GenerationVersion, version_id)
        if version:
            version.status, version.error = 'failed', str(error) or 'Generation interrupted'
            db.commit()
        if path:
            path.unlink(missing_ok=True)
    finally:
        db.close()

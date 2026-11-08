"""音色专属试音：与配音历史分开持久化，试听请求只读文件。"""

import asyncio
import hashlib
import json
import logging
import uuid

from .. import config
from ..database import ProfileSample, VoiceProfile, session
from .task_queue import enqueue_generation

logger = logging.getLogger(__name__)
_active: dict[str, str] = {}
# 固定文案便于横向比较音色；版本进入签名，未来换文案时不会误用旧试音。
TEXT = {
    'zh': '你好，很高兴认识你。清晨的阳光洒进窗台，今天也会是美好的一天。',
    'ar': 'مرحبًا، يسعدني لقاؤك. تملأ شمس الصباح الغرفة. سيكون اليوم يومًا جميلًا.',
    'da': 'Hej, dejligt at møde dig. Morgensolen fylder rummet. I dag bliver en dejlig dag.',
    'el': 'Γεια σας, χαίρομαι που σας γνωρίζω. Ο πρωινός ήλιος φωτίζει το δωμάτιο. Σήμερα θα είναι μια όμορφη μέρα.',
    'fi': 'Hei, hauska tavata. Aamuaurinko valaisee huoneen. Tänään tulee kaunis päivä.',
    'he': 'שלום, נעים להכיר. שמש הבוקר מאירה את החדר. היום יהיה יום יפה.',
    'hi': 'नमस्ते, आपसे मिलकर खुशी हुई। सुबह की धूप कमरे में फैल रही है। आज का दिन सुंदर होगा।',
    'ms': 'Helo, gembira bertemu anda. Cahaya matahari pagi memenuhi bilik. Hari ini akan menjadi hari yang indah.',
    'nl': 'Hallo, leuk je te ontmoeten. De ochtendzon vult de kamer. Vandaag wordt een mooie dag.',
    'no': 'Hei, hyggelig å møte deg. Morgensolen fyller rommet. I dag blir en fin dag.',
    'pl': 'Cześć, miło cię poznać. Poranne słońce wypełnia pokój. Dziś będzie piękny dzień.',
    'sv': 'Hej, trevligt att träffas. Morgonsolen fyller rummet. Idag blir en fin dag.',
    'sw': 'Habari, nimefurahi kukutana nawe. Jua la asubuhi linaangaza chumba. Leo itakuwa siku nzuri.',
    'tr': 'Merhaba, tanıştığıma memnun oldum. Sabah güneşi odayı aydınlatıyor. Bugün güzel bir gün olacak.',
    'en': 'Hello, it is nice to meet you. The morning sunlight fills the room. Today is going to be a beautiful day.',
    'ja': 'こんにちは。お会いできてうれしいです。朝の光が窓から差し込み、素敵な一日が始まります。',
    'ko': '안녕하세요. 만나서 반갑습니다. 아침 햇살이 창가에 비치고, 아름다운 하루가 시작됩니다.',
    'de': 'Hallo, schön dich kennenzulernen. Die Morgensonne scheint ins Zimmer. Heute wird ein schöner Tag.',
    'fr': 'Bonjour, ravi de vous rencontrer. Le soleil du matin illumine la pièce. Une belle journée commence.',
    'ru': 'Здравствуйте, приятно познакомиться. Утреннее солнце освещает комнату. Сегодня будет прекрасный день.',
    'pt': 'Olá, prazer em conhecer você. O sol da manhã ilumina o quarto. Hoje vai ser um lindo dia.',
    'es': 'Hola, es un placer conocerte. El sol de la mañana ilumina la habitación. Hoy será un día hermoso.',
    'it': 'Ciao, piacere di conoscerti. Il sole del mattino illumina la stanza. Oggi sarà una bella giornata.',
}


def effective_preview_text(profile):
    # 统一默认值来源，编辑界面与实际推理不会出现两份不同的文案。
    return (getattr(profile, "preview_text", None) or "").strip() or TEXT.get(profile.language, TEXT["en"])


def _directory(profile_id):
    return config.get_profiles_dir() / profile_id


def _signature(profile, db):
    samples = db.query(ProfileSample).filter_by(profile_id=profile.id).all()
    payload = [getattr(profile, field, None) for field in (
        'language', 'voice_type', 'default_engine', 'preset_engine', 'preset_voice_id', 'design_prompt', 'effects_chain'
    )]
    # 引用样本变化也必须更新试音；不因改名、换头像而重复加载大模型。
    payload += [sorted((s.id, s.reference_text, s.audio_path) for s in samples), TEXT]
    # 默认文案沿用原签名，升级后现有试音仍可用；自定义内容变化才失效。
    text = effective_preview_text(profile)
    if text != TEXT.get(profile.language, TEXT["en"]):
        payload.append(text)
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False).encode()).hexdigest()


def _write(profile_id, state):
    directory = _directory(profile_id)
    directory.mkdir(parents=True, exist_ok=True)
    temporary = directory / 'preview.json.tmp'
    temporary.write_text(json.dumps(state, ensure_ascii=False))
    temporary.replace(directory / 'preview.json')


def preview_state(profile, db):
    try:
        state = json.loads((_directory(profile.id) / 'preview.json').read_text())
    except (OSError, ValueError):
        return {'status': 'missing'}
    if state.get('signature') != _signature(profile, db):
        return {'status': 'missing'}
    if state['status'] == 'generating' and _active.get(profile.id) != state['revision']:
        return {**state, 'status': 'failed', 'error': 'Preview interrupted; save the voice again to retry.'}
    if state['status'] == 'ready' and not (_directory(profile.id) / 'preview.wav').is_file():
        return {'status': 'missing'}
    return state


def schedule_preview(profile_id, db):
    from .profiles import default_engine_for_profile

    profile = db.query(VoiceProfile).filter_by(id=profile_id).first()
    if not profile:
        return
    # 克隆音色必须先上传样本；创建档案的第一步不能触发无参考音频的推理。
    if (profile.voice_type or 'cloned') == 'cloned' and not db.query(ProfileSample).filter_by(profile_id=profile_id).first():
        return
    signature = _signature(profile, db)
    previous = preview_state(profile, db)
    if previous['status'] in ('ready', 'generating'):
        return
    revision = uuid.uuid4().hex
    _active[profile_id] = revision
    _write(profile_id, {'status': 'generating', 'signature': signature, 'revision': revision})
    enqueue_generation(f'preview:{profile_id}:{revision}', _generate(
        profile_id, revision, signature, default_engine_for_profile(profile), profile.language,
    ))


async def _generate(profile_id, revision, signature, engine, language):
    from ..backends import get_tts_backend_for_engine, load_engine_model
    from ..utils.audio import save_audio
    from ..utils.chunked_tts import generate_chunked
    from .profiles import create_voice_prompt_for_profile
    from .generation import release_generation_memory

    # SessionLocal 在启动时初始化，运行时读取模块属性，避免导入期绑定 None。
    db = session.SessionLocal()
    model = None
    temporary = _directory(profile_id) / f'preview-{revision}.wav'
    try:
        # 新版本已排队或档案已删除时，旧任务直接退出，避免覆盖最新试音。
        profile = db.query(VoiceProfile).filter_by(id=profile_id).first()
        if not profile or _active.get(profile_id) != revision or _signature(profile, db) != signature:
            return
        model = get_tts_backend_for_engine(engine)
        await load_engine_model(engine, '1.7B')
        prompt = await create_voice_prompt_for_profile(profile_id, db, engine=engine)
        audio, sample_rate = await generate_chunked(model, effective_preview_text(profile), prompt, language=language, seed=42)
        # 使用独立资源而非 Generation 行，删除历史不会破坏试音，也不污染历史列表。
        if profile.effects_chain:
            from ..utils.effects import apply_effects
            audio = apply_effects(audio, sample_rate, json.loads(profile.effects_chain))
        save_audio(audio, str(temporary), sample_rate)
        db.expire_all()
        profile = db.query(VoiceProfile).filter_by(id=profile_id).first()
        if not profile or _active.get(profile_id) != revision or _signature(profile, db) != signature:
            return
        temporary.replace(_directory(profile_id) / 'preview.wav')
        _write(profile_id, {'status': 'ready', 'signature': signature, 'revision': revision})
    except (Exception, asyncio.CancelledError) as error:
        logger.exception('Voice preview failed for %s', profile_id)
        if _active.get(profile_id) == revision and _directory(profile_id).exists():
            _write(profile_id, {'status': 'failed', 'signature': signature, 'revision': revision, 'error': str(error)})
    finally:
        temporary.unlink(missing_ok=True)
        if _active.get(profile_id) == revision:
            _active.pop(profile_id, None)
        db.close()
        if model:
            release_generation_memory(model)

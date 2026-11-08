"""只发布本次构建的安装包，并附校验和便于用户验证下载。"""
import hashlib
from pathlib import Path
import shutil
import sys

root = Path(__file__).resolve().parents[1]
out = root / 'release-assets'
out.mkdir(exist_ok=True)
files = [p for p in (root / 'tauri/src-tauri/target').rglob('*') if p.suffix in ('.dmg', '.exe', '.deb') and 'bundle' in p.parts]
if len(files) != 1:
    raise RuntimeError(f'Expected one installer, found {files}')
source = files[0]
name = f'VoiceBoxPlus-{sys.argv[1]}{source.suffix}'
dest = out / name
shutil.copy2(source, dest)
(out / f'{name}.sha256').write_text(f'{hashlib.file_digest(dest.open("rb"), "sha256").hexdigest()}  {name}\n')

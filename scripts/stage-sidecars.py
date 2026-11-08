"""统一处理各平台 sidecar 文件名，防止占位开发脚本混入安装包。"""
from pathlib import Path
import shutil
import sys

root = Path(__file__).resolve().parents[1]
target = sys.argv[1]
suffix = '.exe' if 'windows' in target else ''
for name in ('voicebox-server', 'voicebox-mcp'):
    source = root / 'backend' / 'dist' / f'{name}{suffix}'
    if source.stat().st_size < 100_000:
        raise RuntimeError(f'Not a frozen binary: {source}')
    dest = root / 'tauri' / 'src-tauri' / 'binaries' / f'{name}-{target}{suffix}'
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, dest)
    dest.chmod(0o755)

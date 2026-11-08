"""通过官方 Release API 预取依赖，避开 Release 网页直链的临时 504。"""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import zipfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--windows-tools', action='store_true')
parser.add_argument('--directory', type=Path)
args = parser.parse_args()
directory = args.directory or Path(os.environ.get('RUNNER_TEMP', tempfile.gettempdir())) / 'voiceboxplus-ci-deps'
directory.mkdir(parents=True, exist_ok=True)


def download(repo, tag, filename):
    # API 下载和有限重试同时覆盖短暂网络故障，不修改上游依赖或跳过校验。
    for attempt in range(3):
        result = subprocess.run(['gh', 'release', 'download', tag, '--repo', repo, '--pattern', filename, '--dir', str(directory), '--clobber'])
        if result.returncode == 0:
            return directory / filename
        if attempt == 2:
            result.check_returncode()
        time.sleep(10)


wheel = download('explosion/spacy-models', 'en_core_web_sm-3.8.0', 'en_core_web_sm-3.8.0-py3-none-any.whl')
requirements = (root / 'backend/requirements.txt').read_text()
url = 'https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl'
assert url in requirements, 'Update the CI prefetcher when the spaCy model changes'
prepared = directory / 'requirements.txt'
prepared.write_text(requirements.replace(url, wheel.resolve().as_uri()))
if os.name == 'nt' or args.windows_tools:
    # 与锁定的 Tauri CLI 2.9.6 保持一致；哈希来自该版本的官方打包器。
    assert '@tauri-apps/cli@2.9.6' in (root / 'bun.lock').read_text(), 'Update NSIS tools for the new Tauri CLI'
    archive = download('tauri-apps/binary-releases', 'nsis-3.11', 'nsis-3.11.zip')
    plugin = download('tauri-apps/nsis-tauri-utils', 'nsis_tauri_utils-v0.5.2', 'nsis_tauri_utils.dll')
    for path, expected in [(archive, 'ef7ff767e5cbd9edd22add3a32c9b8f4500bb10d'), (plugin, 'd0c502f45df55c0465c9406088ff016c2e7e6817')]:
        assert hashlib.sha1(path.read_bytes()).hexdigest() == expected, f'Unexpected upstream checksum: {path.name}'
    tools = Path(os.environ['LOCALAPPDATA']) / 'tauri' if os.name == 'nt' else directory / 'tauri'
    tools.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as zipped:
        zipped.extractall(tools)
    nsis = tools / 'NSIS'
    if nsis.exists():
        shutil.rmtree(nsis)
    (tools / 'nsis-3.11').rename(nsis)
    plugins = nsis / 'Plugins/x86-unicode/additional'
    plugins.mkdir(parents=True, exist_ok=True)
    shutil.copy2(plugin, plugins / plugin.name)
    assert (nsis / 'makensis.exe').is_file()
    print(f'Verified NSIS toolchain: {nsis}')
print(f'Prepared requirements: {prepared}')

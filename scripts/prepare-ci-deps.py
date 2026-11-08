"""通过官方 Release API 预取依赖，避开 Release 网页直链的临时 504。"""
import argparse
import hashlib
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--windows-tools', action='store_true')
parser.add_argument('--directory', type=Path)
parser.add_argument('--bun-only', action='store_true')
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


system = platform.system()
arm = platform.machine().lower() in ('arm64', 'aarch64')
if args.bun_only:
    # Bun 安装器也使用同一条失效的网页直链，因此预取官方包并核对发布校验和。
    bun_system = {'Darwin': 'darwin', 'Linux': 'linux', 'Windows': 'windows'}[system]
    name = f"bun-{bun_system}-{'aarch64' if arm else 'x64'}"
    archive = download('oven-sh/bun', 'bun-v1.3.11', f'{name}.zip')
    sums = download('oven-sh/bun', 'bun-v1.3.11', 'SHASUMS256.txt')
    expected = next(line.split()[0] for line in sums.read_text().splitlines() if line.split()[-1].lstrip('./') == archive.name)
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == expected
    with zipfile.ZipFile(archive) as zipped:
        zipped.extractall(directory)
    binary = directory / name / ('bun.exe' if os.name == 'nt' else 'bun')
    binary.chmod(0o755)
    subprocess.run([str(binary), '--version'], check=True)
    if os.environ.get('GITHUB_PATH'):
        with open(os.environ['GITHUB_PATH'], 'a') as paths:
            paths.write(f'{binary.parent.resolve()}\n')
    sys.exit(0)

wheel = download('explosion/spacy-models', 'en_core_web_sm-3.8.0', 'en_core_web_sm-3.8.0-py3-none-any.whl')
requirements = (root / 'backend/requirements.txt').read_text()
url = 'https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl'
assert url in requirements, 'Update the CI prefetcher when the spaCy model changes'
prepared = directory / 'requirements.txt'
# 固定传递依赖的本地 wheel，防止 pip 再从 find-links 跳回 GitHub 网页直链。
piper_tag = {'Darwin': 'macosx_11_0_arm64' if arm else 'macosx_10_14_x86_64', 'Linux': 'manylinux2014_x86_64.manylinux_2_17_x86_64', 'Windows': 'win_amd64'}[system]
piper = download('csukuangfj/piper-phonemize', 'v1.5.9', f'piper_phonemize-1.5.9-cp312-cp312-{piper_tag}.whl')
prepared.write_text(f'piper-phonemize @ {piper.resolve().as_uri()}\n' + requirements.replace(url, wheel.resolve().as_uri()))
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

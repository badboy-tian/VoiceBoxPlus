"""用空数据目录启动真正的发布后端，验证路由、模型注册与优雅退出。"""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request

root = Path(__file__).resolve().parents[1]
binary = root / 'backend/dist' / ('voicebox-server.exe' if os.name == 'nt' else 'voicebox-server')
# 随机端口和临时目录确保 CI 不接触用户现有数据库或下载模型。
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
with tempfile.TemporaryDirectory() as directory:
    report = Path(directory) / 'runtime.json'
    checked = subprocess.run([str(binary), '--check-runtime', str(report)], timeout=180)
    details = report.read_text() if report.exists() else 'Runtime report was not written'
    print(details)
    assert checked.returncode == 0, details
    with open(Path(directory) / 'server.log', 'w+', encoding='utf-8', errors='replace') as log:
        process = subprocess.Popen([str(binary), '--host', '127.0.0.1', '--port', str(port), '--data-dir', directory], stdout=log, stderr=log)
        try:
            for _ in range(180):
                if process.poll() is not None:
                    raise RuntimeError(f'Frozen backend exited: {process.returncode}')
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=2) as response:
                        health = json.load(response)
                    break
                except (OSError, ValueError):
                    time.sleep(1)
            else:
                raise RuntimeError('Frozen backend did not become healthy')
            assert health.get('status') == 'healthy', health
            for path in ('/profiles', '/models/status'):
                with urllib.request.urlopen(f'http://127.0.0.1:{port}{path}', timeout=30) as response:
                    payload = json.load(response)
                if path == '/profiles':
                    assert payload == [], payload
                else:
                    assert any(item['model_name'] == 'qwen-voice-design-1.7B' for item in payload['models'])
            print('Frozen backend: health, empty database, and VoiceDesign registry verified')
        finally:
            # Windows 的 onefile 启动器另有子进程，只终止父进程会留下日志句柄和后台服务。
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], check=False)
            else:
                process.terminate()
            try:
                process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            log.seek(0)
            print(log.read()[-8000:])

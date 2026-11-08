"""向运行中的桌面 App 追加设计音色，不覆盖用户已保存的档案。"""
import argparse
import json
from pathlib import Path
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:17594')
args = parser.parse_args()

def request(path, payload=None):
    data = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
    req = urllib.request.Request(args.url + path, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)

existing = {item['name']: item for item in request('/profiles')}
entries = json.loads((Path(__file__).resolve().parents[1] / 'presets/designed-voices.zh.json').read_text())
for entry in entries:
    # 名称用于幂等导入，重复运行既不重建也不改写用户后续调整。
    if entry['name'] in existing:
        print('Skipped', entry['name'], flush=True)
        continue
    profile = request('/profiles', {**entry, 'voice_type': 'designed', 'language': 'zh'})
    existing[entry['name']] = profile
    print('Created', profile['name'], profile['id'], profile['preview_status'], flush=True)

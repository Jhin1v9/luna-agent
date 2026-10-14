import sys, json, urllib.request

BASE = 'http://127.0.0.1:3458'
login = json.load(urllib.request.urlopen(urllib.request.Request(
    BASE + '/api/auth/login', data=json.dumps({"username": "abner", "password": "7741"}).encode(),
    headers={'content-type': 'application/json'}, method='POST')))
token = login['token']

sid = sys.argv[1]
req = urllib.request.Request(f'{BASE}/api/chat/session/{sid}/messages', headers={'authorization': f'Bearer {token}'})
msgs = json.load(urllib.request.urlopen(req)).get('messages', [])
print('total:', len(msgs))
for m in msgs:
    role, t = m.get('role'), m.get('type')
    if t in ('thinking_delta', 'thinking_start', 'response_delta'):
        continue
    if role == 'user':
        print(f"\n[USER/{t}] {str(m.get('content',''))[:250]}")
    elif t in ('action_start', 'action_end'):
        if t == 'action_start':
            print(f"  ⚡ {m.get('tool')} {json.dumps(m.get('params',{}), ensure_ascii=False)[:130]}")
        else:
            r = m.get('result') or {}
            inner = r.get('result') or {}
            stdout = inner.get('stdout') if isinstance(inner, dict) else None
            err = r.get('error') or (inner.get('error') if isinstance(inner, dict) else None)
            ok = '✅' if r.get('success') is not False else '❌'
            print(f"  {ok} {m.get('tool')}: {str(stdout or err or '')[:220]}")
    elif role == 'assistant' and m.get('content'):
        print(f"  [ASST/{t}] {str(m.get('content',''))[:250]}")

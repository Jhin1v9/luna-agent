const BASE = 'https://vps.nexo-digital.app/luna';
async function post(p, b, t) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(b) }); return r.json(); }
async function get(p, t) { const r = await fetch(BASE + p, { headers: t ? { authorization: `Bearer ${t}` } : {} }); return r.json(); }
const login = await post('/api/auth/login', { username: 'abner', password: '7741' });
const token = login.token;
console.log('[1] login ok');
const chat = await post('/api/chat', { message: process.argv[2], mode: 'instant' }, token);
const sessionId = chat.sessionId || chat.session?.id;
console.log('[2] sessão', sessionId);
const deadline = Date.now() + 240000;
let lastCount = 0, tools = [], finalText = null;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 6000));
  const data = await get(`/api/chat/session/${encodeURIComponent(sessionId)}/messages`, token).catch(() => null);
  const msgs = data?.messages || [];
  for (let i = lastCount; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.type === 'action_start') console.log(`    ⚡ ${m.tool} ${JSON.stringify(m.params || {}).slice(0, 120)}`);
    if (m.type === 'action_end') { const ok = m.result?.success !== false; const out = String(m.result?.result?.stdout || m.result?.error || '').slice(0, 200); console.log(`    ${ok ? '✅' : '❌'} ${m.tool}: ${out}`); tools.push({ tool: m.tool, ok }); }
  }
  lastCount = msgs.length;
  const texts = msgs.filter((m) => m.role === 'assistant' && ['text','assistant','done',undefined].includes(m.type) && m.content);
  const last = texts[texts.length - 1];
  if (last) { const lastTs = new Date(last.timestamp || 0).getTime(); const quiet = tools.length > 0 ? 8000 : 12000; if (Date.now() - lastTs > quiet) { finalText = last.content; break; } }
}
console.log(`\n[3] tools: ${tools.map((t) => `${t.tool}${t.ok ? '✅' : '❌'}`).join(', ') || 'nenhuma'}`);
console.log('[4]', (finalText || '(sem resposta)').slice(0, 350));

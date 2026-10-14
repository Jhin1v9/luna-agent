// Teste E2E da Luna Web via API de chat (login + sessão real).
// Uso: node e2e-luna-web.mjs "<mensagem>" [timeoutSeg]
const BASE = 'http://127.0.0.1:3458';

const msg = process.argv[2];
const timeoutS = Number(process.argv[3] || 280);
if (!msg) { console.error('mensagem obrigatória'); process.exit(1); }

async function post(path, body, token) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return r.json();
}
async function get(path, token) {
  const r = await fetch(BASE + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return r.json();
}

const t0 = Date.now();
const login = await post('/api/auth/login', { username: 'abner', password: '7741' });
if (!login.ok) { console.error('LOGIN FALHOU:', JSON.stringify(login)); process.exit(1); }
const token = login.token;
console.log(`[1] login ok (${Date.now() - t0}ms)`);

const chat = await post('/api/chat', { message: msg, mode: 'instant' }, token);
if (!chat?.sessionId && !chat?.session?.id) { console.error('CHAT FALHOU:', JSON.stringify(chat).slice(0, 400)); process.exit(1); }
const sessionId = chat.sessionId || chat.session.id;
console.log(`[2] sessão ${sessionId} — aguardando a Luna trabalhar...`);

const deadline = Date.now() + timeoutS * 1000;
let lastCount = 0;
let tools = [];
let finalText = null;

while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 6000));
  const data = await get(`/api/chat/session/${encodeURIComponent(sessionId)}/messages`, token).catch(() => null);
  const msgs = data?.messages || [];
  for (let i = lastCount; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.type === 'action_start') console.log(`    ⚡ tool → ${m.tool} ${JSON.stringify(m.params || {}).slice(0, 140)}`);
    if (m.type === 'action_end') {
      const ok = m.result?.success !== false;
      console.log(`    ${ok ? '✅' : '❌'} fim  → ${m.tool}: ${String(m.result?.result?.stdout || m.result?.error || JSON.stringify(m.result || {}).slice(0, 160)).slice(0, 300)}`);
      tools.push({ tool: m.tool, ok });
    }
    if (m.role === 'assistant' && m.type === 'text' && m.content && !finalText) {
      // pega a última resposta de texto (pode vir depois das tools)
    }
  }
  lastCount = msgs.length;
  // última mensagem de texto do assistant
  const texts = msgs.filter((m) => m.role === 'assistant' && ['text', 'assistant', 'done', undefined].includes(m.type) && m.content);
  const last = texts[texts.length - 1];
  if (last && tools.length > 0) {
    // espera ter acabado: se a última msg é texto e já passou 6s desde o último evento
    const lastTs = new Date(last.timestamp || 0).getTime();
    if (Date.now() - lastTs > 6000) { finalText = last.content; break; }
  }
  if (last && tools.length === 0) {
    const lastTs = new Date(last.timestamp || 0).getTime();
    if (Date.now() - lastTs > 12000) { finalText = last.content; break; }
  }
}

console.log(`\n[3] ${tools.length} tool(s) executada(s): ${tools.map((t) => `${t.tool}${t.ok ? '✅' : '❌'}`).join(', ') || 'nenhuma'}`);
console.log(`[4] resposta (${Date.now() - t0}ms):`, (finalText || '(sem resposta textual)').slice(0, 500));

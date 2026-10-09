#!/usr/bin/env node
// Painel de controle da Luna — 127.0.0.1:3101 (só localhost, sem auth: uso local).
// Controle total: modo/fast brain (.env), validação de APIs, envio direto pro zap
// pelo pipeline oficial (messages + pg_notify), atividade com "responder de novo",
// countdown dos serviços (heartbeats).
// Uso: node scripts/painel-luna/server.mjs   (ou --port 3101)
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ENV = path.join(ROOT, '.env');
const PORT = Number(process.argv[process.argv.indexOf('--port') + 1] ?? 3101) || 3101;
const COLIBRI = (process.env.VENUS_BASE_URL ?? 'http://127.0.0.1:8000/v1').replace(/\/$/, '');
const BRAIN_REMOTE = 'https://vps.nexo-digital.app/brain/';
const MODES = ['mock', 'kimi-web', 'kimi-api', 'kimi-cli', 'kimi-web-local', 'gemini', 'pi', 'kimiwork'];
const ENV_EDITABLE = { KIMI_ADAPTER_MODE: MODES, LIVE_BRAIN_PROVIDER: ['kimi', 'kimiwork'], VENUS_AUTONOMO: ['true', 'false'] };
const BEAT_INTERVAL_S = { orchestrator: 30, worker: 30, watchdog: 30, whatsplay: 15 };

function envAll() {
  const out = {};
  for (const line of fs.readFileSync(REPO_ENV, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    out[t.slice(0, i)] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = () => envAll();
const dbUrl = () => { const u = env().DATABASE_URL; if (!u) throw new Error('DATABASE_URL ausente'); return u; };
const pg = await import('pg');
async function db(query, params = []) {
  const c = new pg.Client({ connectionString: dbUrl() });
  await c.connect();
  try { return await c.query(query, params); } finally { await c.end(); }
}
function envSet(key, value) {
  if (!ENV_EDITABLE[key]) throw new Error(`chave não editável pelo painel: ${key}`);
  if (!ENV_EDITABLE[key].includes(value)) throw new Error(`valor inválido pra ${key}: ${value}`);
  const lines = fs.readFileSync(REPO_ENV, 'utf8').split(/\r?\n/);
  const idx = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  const tmp = REPO_ENV + '.tmp';
  fs.writeFileSync(tmp, lines.join('\n'));
  fs.renameSync(tmp, REPO_ENV); // atômico
}

const PRAZO_RE = /(esta semana|essa semana|nesta semana|te entrego|fica pronto|agendamos|pra (hoje|amanhã)|até (hoje|amanhã|sexta))/i;
async function enviarWhatsapp(chatId, texto, sender = 'luna', source = 'painel') {
  if (!chatId || !texto) throw new Error('chat_id e texto são obrigatórios');
  if (PRAZO_RE.test(texto)) throw new Error('guard-rail: promessa de prazo detectada — reformule');
  if (texto.length > 900) throw new Error('texto acima de 900 chars');
  const conv = await db(
    `SELECT conversation_id FROM messages WHERE metadata->>'chat_id' = $1 ORDER BY created_at DESC LIMIT 1`,
    [chatId],
  );
  if (!conv.rows[0]) throw new Error('conversation_id não encontrada pra este chat_id');
  const ins = await db(
    `INSERT INTO messages (conversation_id, direction, channel, sender, body, send_state, metadata)
     VALUES ($1, 'outbound', 'whatsapp', $2, $3, 'queued', $4) RETURNING id`,
    [conv.rows[0].conversation_id, sender, texto, JSON.stringify({ source, chat_id: chatId })],
  );
  await db(`SELECT pg_notify('luna_outbound', $1)`, [ins.rows[0].id]);
  return ins.rows[0].id;
}

async function checks() {
  const e = env();
  const out = {};
  try { const r = await fetch(`${COLIBRI}/models`, { signal: AbortSignal.timeout(3_000) }); const d = await r.json(); out.venus = { ok: r.ok, detalhe: d.data?.[0]?.id ?? `HTTP ${r.status}` }; }
  catch (err) { out.venus = { ok: false, detalhe: 'colibri fora do ar (127.0.0.1:8000)' }; }
  try { await db('SELECT 1'); out.postgres = { ok: true, detalhe: dbUrl().split('@')[1]?.split('/')[0] ?? 'ok' }; }
  catch (err) { out.postgres = { ok: false, detalhe: err.message.slice(0, 80) }; }
  try { const r = await fetch(`https://api.telegram.org/bot${e.TELEGRAM_BOT_TOKEN}/getMe`, { signal: AbortSignal.timeout(5_000) }); const d = await r.json(); out.telegram = { ok: !!d.ok, detalhe: d.ok ? `@${d.result.username}` : 'token inválido' }; }
  catch (err) { out.telegram = { ok: false, detalhe: 'rede/timeout' }; }
  try { const r = await fetch(BRAIN_REMOTE, { signal: AbortSignal.timeout(5_000) }); out.brain_remoto = { ok: r.ok || r.status < 500, detalhe: `HTTP ${r.status}` }; }
  catch (err) { out.brain_remoto = { ok: false, detalhe: 'inacessível' }; }
  const keys = Object.keys(e);
  out.kimi_api = { ok: keys.some((k) => k === 'KIMI_API_KEY' || k === 'LLM_API_KEY'), detalhe: keys.filter((k) => k.startsWith('KIMI_API_KEY') || k === 'LLM_API_KEY').join(', ') || 'nenhuma key no .env' };
  out.gemini = { ok: keys.includes('GEMINI_API_KEY'), detalhe: keys.includes('GEMINI_API_KEY') ? 'key presente' : 'sem GEMINI_API_KEY' };
  return out;
}

async function atividade() {
  const r = await db(
    `SELECT id, sender, metadata->>'chat_id' AS chat_id, conversation_id, left(body, 220) AS body, send_state, created_at
     FROM messages WHERE direction='outbound' AND sender IN ('luna','agent:venus') ORDER BY created_at DESC LIMIT 15`,
  );
  return r.rows;
}
async function contexto(conversationId) {
  const r = await db(
    `SELECT direction, sender, left(body, 500) AS body, created_at FROM messages
     WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 8`,
    [conversationId],
  );
  return r.rows.reverse();
}
async function servicos() {
  const r = await db('SELECT service, pid, meta, seen_at FROM service_heartbeats ORDER BY service');
  const now = Date.now();
  return r.rows.map((s) => {
    const age = Math.round((now - new Date(s.seen_at).getTime()) / 1000);
    const interval = BEAT_INTERVAL_S[s.service];
    return {
      service: s.service, pid: s.pid, age_s: age,
      estado: s.meta?.state ?? s.meta?.overall ?? (s.meta?.ready ? 'READY' : '—'),
      sessao: s.meta?.session ?? null,
      next_beat_s: interval ? Math.max(0, interval - age) : null,
      stale: age > 90,
    };
  });
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) data += chunk;
  return data ? JSON.parse(data) : {};
}

// ── Erros do Vênus pro painel (decreto owner 2026-10-09: "pega o log do venus
// e deixa tudo na parte de erros do painel") — une incidências da inbox com
// as linhas de erro dos logs pm2, pra gente trabalhar em cima depois.
const PM2_LOGS = path.join(process.env.USERPROFILE ?? 'C:\\Users\\Abner', '.pm2', 'logs');
const ERRO_PATTERNS = /(✗|ERRO|erro no ciclo|erro processando|erro na ordem|fetch failed|BLOQUEADO|estourou|ECONNREFUSED|timeout)/i;
const RUIDO_PATTERNS = /NODE\.CMD|SyntaxError: Invalid or unexpected token|electron/i;
function tailLog(file, maxBytes = 200_000) {
  try {
    const size = fs.statSync(file).size;
    const buf = Buffer.alloc(Math.min(size, maxBytes));
    const fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, buf.length, size - buf.length);
    fs.closeSync(fd);
    return buf.toString('utf8').split(/\r?\n/);
  } catch { return []; }
}
async function venusErros() {
  // 1) incidências: eventos que cairam em error (motivo gravado no result)
  const inc = await db(
    `SELECT id, kind, received_at, result->>'motivo' AS motivo, result->>'processed_by' AS por
     FROM kimiwork_inbox WHERE status='error' AND received_at > now() - interval '48 hours'
     ORDER BY received_at DESC LIMIT 30`,
  );
  // 2) linhas de erro dos logs (out tem os "[vênus] erro no ciclo"; error log
  // tem ruído do NODE.CMD do daimon — filtrado)
  const linhas = [];
  for (const [fonte, file] of [['out', 'venus-varredura-out.log'], ['err', 'venus-varredura-error.log']]) {
    for (const ln of tailLog(path.join(PM2_LOGS, file))) {
      const t = ln.trim();
      if (!t || !ERRO_PATTERNS.test(t) || RUIDO_PATTERNS.test(t)) continue;
      linhas.push({ fonte, linha: t.slice(0, 300) });
    }
  }
  return { incidencias: inc.rows, log: linhas.slice(-60) };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const send = (obj, code = 200) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(HTML);
    } else if (url.pathname === '/api/status' && req.method === 'GET') {
      const e = env();
      const chats = await db(
        `SELECT metadata->>'chat_id' AS chat_id, COUNT(*)::int AS n, MAX(created_at) AS last_at
         FROM messages WHERE direction='outbound' AND metadata->>'chat_id' IS NOT NULL
         GROUP BY 1 ORDER BY last_at DESC LIMIT 20`,
      );
      send({ modo: { KIMI_ADAPTER_MODE: e.KIMI_ADAPTER_MODE ?? 'mock', LIVE_BRAIN_PROVIDER: e.LIVE_BRAIN_PROVIDER ?? 'kimi', VENUS_AUTONOMO: e.VENUS_AUTONOMO ?? 'false' }, modos: MODES, editaveis: ENV_EDITABLE, checks: await checks(), servicos: await servicos(), chats: chats.rows });
    } else if (url.pathname === '/api/modo' && req.method === 'POST') {
      const b = await readBody(req);
      envSet(b.key, String(b.value));
      send({ ok: true, modo: { [b.key]: String(b.value) } });
    } else if (url.pathname === '/api/enviar' && req.method === 'POST') {
      const b = await readBody(req);
      const sender = ['luna', 'agent:venus'].includes(b.sender) ? b.sender : 'luna';
      const id = await enviarWhatsapp(b.chat_id, b.texto, sender, 'painel');
      send({ ok: true, id });
    } else if (url.pathname === '/api/atividade' && req.method === 'GET') {
      send({ atividade: await atividade() });
    } else if (url.pathname === '/api/contexto' && req.method === 'GET') {
      send({ contexto: await contexto(url.searchParams.get('conversation_id')) });
    } else if (url.pathname === '/api/venus-supervision' && req.method === 'GET') {
      const r = await db(
        `SELECT id, chat_id, left(body, 220) AS body, critic, flagged, luna_verdict, luna_action, created_at, reviewed_at
         FROM venus_supervision ORDER BY created_at DESC LIMIT 20`,
      );
      send({ supervisao: r.rows });
    } else if (url.pathname === '/api/venus-erros' && req.method === 'GET') {
      send(await venusErros());
    } else {
      send({ erro: 'rota não encontrada' }, 404);
    }
  } catch (e) {
    send({ erro: e.message.slice(0, 200) }, 400);
  }
});

const HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Painel da Luna</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --bg:#0d1117; --card:#161b22; --borda:#30363d; --txt:#e6edf3; --dim:#8b949e; --ok:#3fb950; --erro:#f85149; --azul:#58a6ff; --roxo:#bc8cff; }
  * { box-sizing:border-box; margin:0; }
  body { background:var(--bg); color:var(--txt); font:14px/1.5 -apple-system, "Segoe UI", sans-serif; padding:20px; max-width:1100px; margin:0 auto; }
  h1 { font-size:20px; margin-bottom:4px; } h1 span { color:var(--roxo); }
  .sub { color:var(--dim); margin-bottom:18px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:14px; }
  .card { background:var(--card); border:1px solid var(--borda); border-radius:10px; padding:14px; }
  .card h2 { font-size:13px; text-transform:uppercase; letter-spacing:.5px; color:var(--dim); margin-bottom:10px; }
  select, input, textarea, button { background:#0d1117; color:var(--txt); border:1px solid var(--borda); border-radius:6px; padding:8px 10px; font:inherit; width:100%; }
  button { background:#1f6feb; border-color:#1f6feb; cursor:pointer; font-weight:600; width:auto; }
  button.ghost { background:transparent; border-color:var(--borda); color:var(--azul); }
  button:hover { filter:brightness(1.15); }
  .linha { display:flex; gap:8px; align-items:center; margin-bottom:8px; }
  .linha > * { flex:1; } .linha > button, .linha > .fix { flex:0 0 auto; }
  .check { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--borda); }
  .check:last-child { border-bottom:0; }
  .dot { width:8px; height:8px; border-radius:50%; display:inline-block; margin-right:6px; }
  .ok { color:var(--ok); } .erro { color:var(--erro); } .dim { color:var(--dim); }
  .item { padding:8px; border:1px solid var(--borda); border-radius:8px; margin-bottom:8px; }
  .item .meta { color:var(--dim); font-size:12px; margin-bottom:3px; }
  .item .body { white-space:pre-wrap; word-break:break-word; }
  .barra { height:6px; background:#21262d; border-radius:3px; overflow:hidden; margin-top:4px; }
  .barra > div { height:100%; background:var(--azul); transition:width 1s linear; }
  .badge { font-size:11px; padding:2px 8px; border-radius:10px; border:1px solid var(--borda); }
  #toast { position:fixed; bottom:16px; right:16px; background:var(--card); border:1px solid var(--borda); padding:10px 14px; border-radius:8px; display:none; max-width:360px; }
  details { margin-top:6px; } summary { cursor:pointer; color:var(--azul); font-size:12px; }
</style>
</head>
<body>
<h1>🌙 Painel da <span>Luna</span> <span style="color:var(--azul)">× 🪐 Vênus</span></h1>
<div class="sub">Controle total — localhost:3101 · auto-refresh 10s</div>

<div class="grid">
  <div class="card">
    <h2>🧠 Modo / Fast brain (.env)</h2>
    <div class="linha">
      <select id="fb"></select>
      <button onclick="setModo('KIMI_ADAPTER_MODE', document.getElementById('fb').value)">Aplicar</button>
    </div>
    <div class="linha">
      <label class="dim fix">Live brain</label>
      <select id="lb"><option value="kimi">kimi</option><option value="kimiwork">kimiwork</option></select>
      <button onclick="setModo('LIVE_BRAIN_PROVIDER', document.getElementById('lb').value)">Aplicar</button>
    </div>
    <div class="linha">
      <label class="dim fix">🪐 Vênus autônomo</label>
      <select id="va"><option value="true">ligado</option><option value="false">desligado</option></select>
      <button onclick="setModo('VENUS_AUTONOMO', document.getElementById('va').value)">Aplicar</button>
    </div>
    <div class="dim" style="font-size:12px" id="modoAtual"></div>
  </div>

  <div class="card">
    <h2>🔌 Validação de APIs</h2>
    <div id="checks"><span class="dim">carregando…</span></div>
  </div>

  <div class="card" style="grid-column:1/-1">
    <h2>📨 Enviar mensagem (pipeline oficial — messages + luna_outbound)</h2>
    <div class="linha">
      <select id="chat"></select>
    </div>
    <textarea id="texto" rows="4" placeholder="Mensagem… (guard-rail ativo: sem promessa de prazo)"></textarea>
    <div class="linha" style="margin-top:8px">
      <button onclick="enviar()">Enviar como Luna</button>
      <button class="ghost" onclick="enviar('agent:venus')">Enviar como Vênus 🪐</button>
      <span class="dim" id="envStatus"></span>
    </div>
  </div>

  <div class="card">
    <h2>⏱️ Serviços & próximo beat</h2>
    <div id="servicos"><span class="dim">carregando…</span></div>
  </div>

  <div class="card" style="grid-column:1/-1">
    <h2>Guarda da irmã maior — supervisão do O Vênus (crítico por regras, zero tokens)</h2>
    <div id="supervisao"><span class="dim">carregando…</span></div>
  </div>

  <div class="card" style="grid-column:1/-1">
    <h2>🩸 Erros & incidências do Vênus (inbox em error + logs pm2 — pra trabalharmos em cima)</h2>
    <div id="venusErros"><span class="dim">carregando…</span></div>
  </div>

  <div class="card" style="grid-column:1/-1">
    <h2>📜 Atividade recente (responder de novo com contexto)</h2>
    <div id="atividade"><span class="dim">carregando…</span></div>
  </div>
</div>

<div id="toast"></div>

<script>
async function api(p, opt) { const r = await fetch(p, opt); return r.json(); }
function toast(msg, erro) { const t = document.getElementById('toast'); t.textContent = msg; t.style.borderColor = erro ? 'var(--erro)' : 'var(--ok)'; t.style.display = 'block'; setTimeout(() => t.style.display = 'none', 4000); }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function refresh() {
  const s = await api('/api/status');
  document.getElementById('modoAtual').textContent = 'atual: fast brain=' + s.modo.KIMI_ADAPTER_MODE + ' · live=' + s.modo.LIVE_BRAIN_PROVIDER + ' · vênus=' + s.modo.VENUS_AUTONOMO;
  const fb = document.getElementById('fb');
  if (!fb.options.length) s.modos.forEach(m => fb.add(new Option(m, m)));
  fb.value = s.modo.KIMI_ADAPTER_MODE; document.getElementById('lb').value = s.modo.LIVE_BRAIN_PROVIDER; document.getElementById('va').value = s.modo.VENUS_AUTONOMO;
  // dropdown de chats conhecidos (saídas reais recentes) — texto aberto virou select
  const sel = document.getElementById('chat');
  const atual = sel.value;
  sel.innerHTML = s.chats.map(c => new Option(c.chat_id + '  (' + c.n + ' msgs)', c.chat_id)).map(o => o.outerHTML).join('');
  if ([...sel.options].some(o => o.value === atual)) sel.value = atual;
  document.getElementById('checks').innerHTML = Object.entries(s.checks).map(([k, v]) =>
    '<div class="check"><span><span class="dot" style="background:' + (v.ok ? 'var(--ok)' : 'var(--erro)') + '"></span>' + esc(k) + '</span><span class="dim">' + esc(v.detalhe) + '</span></div>').join('');
  document.getElementById('servicos').innerHTML = s.servicos.map(v => {
    const pct = v.next_beat_s != null ? Math.min(100, Math.round((1 - v.next_beat_s / 30) * 100)) : 0;
    return '<div class="item"><div class="meta"><b>' + esc(v.service) + '</b> · pid ' + v.pid + ' · <span class="' + (v.stale ? 'erro' : 'ok') + '">' + (v.stale ? 'PARADO há ' + v.age_s + 's' : 'vivo há ' + v.age_s + 's') + '</span> <span class="badge">' + esc(v.estado) + '</span></div>' +
      (v.next_beat_s != null ? '<div class="dim" style="font-size:12px">próximo beat estimado em ' + v.next_beat_s + 's</div><div class="barra"><div style="width:' + pct + '%"></div></div>' : '') + '</div>';
  }).join('');
  const sup = await api('/api/venus-supervision');
  document.getElementById('supervisao').innerHTML = sup.supervisao.map(v =>
    '<div class="item"><div class="meta"><b>' + esc(v.chat_id) + '</b> · ' + new Date(v.created_at).toLocaleString('pt-BR') +
    ' · <span class="' + (v.flagged ? 'erro' : 'ok') + '">' + (v.flagged ? 'FLAG: ' + esc((v.critic?.reasons ?? []).join('; ')) : 'passou no crítico') + '</span>' +
    (v.luna_verdict ? ' · veredito: <b>' + esc(v.luna_verdict) + '</b>' : ' · <span class="dim">aguardando a Luna</span>') + '</div>' +
    '<div class="body">' + esc(v.body) + '</div>' +
    (v.luna_action ? '<div class="meta">ação da Luna: ' + esc(v.luna_action) + '</div>' : '') + '</div>'
  ).join('') || '<span class="dim">nenhuma mensagem dele avaliada ainda</span>';
  const ve = await api('/api/venus-erros');
  const incHtml = (ve.incidencias ?? []).map(v =>
    '<div class="item"><div class="meta"><b>' + esc(v.kind) + '</b> · ' + new Date(v.received_at).toLocaleString('pt-BR') +
    ' · <span class="erro">error</span>' + (v.por ? ' · por: ' + esc(v.por) : '') + '</div>' +
    '<div class="body">' + esc(v.motivo ?? '(sem motivo registrado)') + '</div></div>').join('');
  const logHtml = (ve.log ?? []).map(v =>
    '<div class="meta">[' + esc(v.fonte) + '] ' + esc(v.linha) + '</div>').join('');
  document.getElementById('venusErros').innerHTML =
    (incHtml ? '<h2 style="margin-top:4px">Incidências (48h)</h2>' + incHtml : '<span class="dim">sem incidências em 48h</span>') +
    (logHtml ? '<h2 style="margin-top:12px">Últimas linhas de erro (logs)</h2>' + logHtml : '');
  const a = await api('/api/atividade');
  document.getElementById('atividade').innerHTML = a.atividade.map(m =>
    '<div class="item"><div class="meta"><b>' + esc(m.sender) + '</b> → ' + esc(m.chat_id) + ' · ' + new Date(m.created_at).toLocaleString('pt-BR') + ' · <span class="' + (m.send_state === 'sent' ? 'ok' : 'erro') + '">' + esc(m.send_state) + '</span></div>' +
    '<div class="body">' + esc(m.body) + '</div>' +
    '<details><summary>contexto + responder de novo</summary><div class="ctx" data-conv="' + m.conversation_id + '"><span class="dim">carregando…</span></div>' +
    '<div class="linha" style="margin-top:6px"><input class="re-chat" value="' + esc(m.chat_id) + '"><button class="ghost" onclick="responderDnv(this)">Responder com contexto</button></div></details></div>'
  ).join('') || '<span class="dim">sem atividade</span>';
  document.querySelectorAll('details').forEach(d => d.addEventListener('toggle', async () => {
    if (d.open && !d.dataset.loaded) {
      d.dataset.loaded = 1;
      const conv = d.querySelector('.ctx').dataset.conv;
      const c = await api('/api/contexto?conversation_id=' + conv);
      d.querySelector('.ctx').innerHTML = c.contexto.map(m => '<div class="meta">[' + esc(m.direction) + '/' + esc(m.sender) + '] ' + esc(m.body) + '</div>').join('') || '<span class="dim">sem contexto</span>';
    }
  }));
}

async function setModo(key, value) {
  const r = await api('/api/modo', { method: 'POST', body: JSON.stringify({ key, value }) });
  toast(r.ok ? key + ' = ' + value + ' gravado no .env ✅' : 'ERRO: ' + r.erro, !r.ok);
  refresh();
}
async function enviar(sender) {
  const r = await api('/api/enviar', { method: 'POST', body: JSON.stringify({ chat_id: document.getElementById('chat').value, texto: document.getElementById('texto').value, sender }) });
  document.getElementById('envStatus').textContent = r.ok ? 'enfileirada ✅' : 'ERRO: ' + r.erro;
  if (r.ok) { document.getElementById('texto').value = ''; toast('mensagem enfileirada — send via pipeline oficial'); }
  refresh();
}
function responderDnv(btn) {
  const item = btn.closest('.item');
  const ctx = [...item.querySelectorAll('.ctx .meta')].map(x => x.textContent).join('\\n');
  const body = item.querySelector('.body').textContent;
  document.getElementById('chat').value = item.querySelector('.re-chat').value;
  document.getElementById('texto').value = '[contexto da conversa]\\n' + ctx.slice(-2000) + '\\n\\n[última msg nossa]\\n' + body + '\\n\\n[nova resposta]\\n';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast('compositor carregado com contexto — edite e envie');
}
refresh(); setInterval(refresh, 10_000);
</script>
</body>
</html>`;

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[painel-luna] no ar em http://127.0.0.1:${PORT} (só localhost)`);
});

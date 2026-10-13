#!/usr/bin/env node
// Painel de controle da Luna — 127.0.0.1:3101 (só localhost, sem auth: uso local).
// Controle total: modo/fast brain (.env), validação de APIs, envio direto pro zap
// pelo pipeline oficial (messages + pg_notify), atividade com "responder de novo",
// countdown dos serviços (heartbeats).
// Uso: node scripts/painel-luna/server.mjs   (ou --port 3101)
// v2.0 — frontend reescrito (menu SPA, refresh cirúrgico, animações). Backend INALTERADO.
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
<title>Painel da Luna — v2</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root{
    --bg:#0b0e14; --bg2:#11151f; --card:#161b26; --borda:#262d3d; --borda2:#323b50;
    --txt:#e6edf3; --dim:#8b949e; --ok:#3fb950; --erro:#f85149; --azul:#58a6ff; --roxo:#bc8cff; --amarelo:#d29922;
    --rad:12px; --ease:cubic-bezier(.22,.9,.28,1);
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--txt);font:14px/1.55 -apple-system,"Segoe UI",sans-serif;
    display:grid;grid-template-columns:228px 1fr;height:100vh;overflow:hidden}
  ::-webkit-scrollbar{width:8px;height:8px}
  ::-webkit-scrollbar-thumb{background:var(--borda);border-radius:8px}

  /* ── SIDEBAR ── */
  aside{background:var(--bg2);border-right:1px solid var(--borda);display:flex;flex-direction:column}
  .brand{display:flex;align-items:center;gap:10px;padding:16px 14px;border-bottom:1px solid var(--borda)}
  .brand .logo{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;font-size:16px;
    background:linear-gradient(135deg,var(--roxo),var(--azul));animation:pulse 3s infinite}
  @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(188,140,255,.4)}50%{box-shadow:0 0 0 7px rgba(188,140,255,0)}}
  .brand h1{font-size:15px;letter-spacing:.4px}
  .brand small{color:var(--dim);font-size:10.5px;display:block}
  nav{flex:1;padding:10px 8px;overflow-y:auto}
  .nav-item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 11px;margin:2px 0;background:none;
    border:none;color:var(--dim);border-radius:9px;cursor:pointer;font-size:13.5px;text-align:left;transition:all .18s var(--ease)}
  .nav-item:hover{background:var(--card);color:var(--txt);transform:translateX(3px)}
  .nav-item.active{background:linear-gradient(90deg,rgba(188,140,255,.14),transparent);color:var(--txt);box-shadow:inset 3px 0 0 var(--roxo)}
  .nav-item .ico{width:20px;text-align:center}
  .side-foot{padding:12px 14px;border-top:1px solid var(--borda);font-size:11px;color:var(--dim)}

  /* ── MAIN ── */
  main{display:flex;flex-direction:column;overflow:hidden}
  header{display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid var(--borda);background:var(--bg2)}
  .dot{width:9px;height:9px;border-radius:50%;background:var(--dim);transition:background .3s}
  .dot.on{background:var(--ok);box-shadow:0 0 8px var(--ok)}
  .dot.off{background:var(--erro)}
  .chip{padding:4px 12px;border-radius:99px;background:var(--card);border:1px solid var(--borda);font-size:11.5px;color:var(--dim)}
  .chip b{color:var(--roxo);font-weight:600}
  .spacer{flex:1}
  .page{display:none;flex:1;overflow:hidden}
  .page.active{display:flex;flex-direction:column;animation:fade .25s var(--ease)}
  @keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1}}
  .pad{flex:1;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:14px;max-width:1150px;width:100%;margin:0 auto}

  .card{background:var(--card);border:1px solid var(--borda);border-radius:var(--rad);padding:16px;transition:transform .18s var(--ease),border-color .18s}
  .card:hover{border-color:var(--borda2)}
  .card h2{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--dim);margin-bottom:12px;display:flex;align-items:center;gap:8px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media(max-width:900px){body{grid-template-columns:60px 1fr}.brand div,.nav-item span.txt,.side-foot{display:none}.grid2{grid-template-columns:1fr}}

  select,input,textarea,button{background:var(--bg);color:var(--txt);border:1px solid var(--borda);border-radius:8px;padding:9px 11px;font:inherit}
  select:focus,input:focus,textarea:focus{outline:none;border-color:var(--roxo)}
  button{background:linear-gradient(135deg,#6e40c9,#58a6ff);border:none;cursor:pointer;font-weight:600;color:#fff;transition:all .18s var(--ease)}
  button:hover{filter:brightness(1.15);transform:translateY(-1px)}
  button:disabled{opacity:.45;cursor:not-allowed;transform:none}
  button.ghost{background:transparent;border:1px solid var(--borda);color:var(--azul)}
  button.danger{background:transparent;border:1px solid rgba(248,81,73,.4);color:var(--erro)}
  .linha{display:flex;gap:8px;align-items:center;margin-bottom:8px}
  .linha>*{flex:1}.linha>button,.linha>.fix{flex:0 0 auto}
  .hint{font-size:11.5px;color:var(--dim);margin-top:6px}
  .charcount{font-size:11px;color:var(--dim);text-align:right}
  .charcount.over{color:var(--erro)}

  .check{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--borda);animation:fade .3s var(--ease)}
  .check:last-child{border-bottom:0}
  .mini-dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:7px}
  .ok{color:var(--ok)}.erro{color:var(--erro)}.dim{color:var(--dim)}
  .badge{font-size:10.5px;padding:2px 9px;border-radius:99px;border:1px solid var(--borda);color:var(--dim)}
  .badge.ok{color:var(--ok);border-color:rgba(63,185,80,.35)}
  .badge.erro{color:var(--erro);border-color:rgba(248,81,73,.35)}

  .svc{padding:12px;border:1px solid var(--borda);border-radius:10px;margin-bottom:10px;animation:fade .3s var(--ease)}
  .svc.stale{border-color:rgba(248,81,73,.5);background:rgba(248,81,73,.05)}
  .svc .top{display:flex;align-items:center;gap:8px;margin-bottom:4px}
  .svc .top b{font-size:13.5px}
  .barra{height:5px;background:var(--bg);border-radius:3px;overflow:hidden;margin-top:6px}
  .barra>div{height:100%;background:linear-gradient(90deg,var(--azul),var(--roxo));transition:width 1s linear}

  .item{padding:11px 13px;border:1px solid var(--borda);border-radius:10px;margin-bottom:9px;animation:fade .3s var(--ease)}
  .item .meta{color:var(--dim);font-size:11.5px;margin-bottom:4px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .item .body{white-space:pre-wrap;word-break:break-word;font-size:13px}
  details{margin-top:7px}summary{cursor:pointer;color:var(--azul);font-size:12px}
  details[open] summary{margin-bottom:6px}
  .ctx{background:var(--bg);border:1px solid var(--borda);border-radius:8px;padding:9px 11px;font-size:12px;max-height:260px;overflow:auto}
  .ctx .meta{display:block;margin-bottom:4px}
  .logline{font-family:Consolas,monospace;font-size:11.5px;padding:5px 8px;border-bottom:1px solid var(--borda);word-break:break-all}
  .logline:last-child{border-bottom:0}
  .fonte-tag{font-size:10px;padding:1px 6px;border-radius:6px;background:var(--bg);border:1px solid var(--borda);margin-right:6px}

  .skeleton{height:14px;border-radius:6px;background:linear-gradient(90deg,var(--card) 25%,var(--borda) 50%,var(--card) 75%);
    background-size:200% 100%;animation:shimmer 1.3s infinite;margin-bottom:9px}
  @keyframes shimmer{from{background-position:200% 0}to{background-position:-200% 0}}

  #toast{position:fixed;bottom:18px;right:18px;background:var(--card);border:1px solid var(--ok);
    padding:12px 16px;border-radius:10px;display:none;max-width:380px;z-index:99;animation:fade .25s var(--ease);box-shadow:0 10px 30px rgba(0,0,0,.5)}
  .empty{color:var(--dim);text-align:center;padding:28px 0;font-size:13px}
  .skel-wrap{padding:4px 0}
</style>
</head>
<body>
<aside>
  <div class="brand"><div class="logo">🌙</div><div><h1>LUNA</h1><small>Painel de controle v2</small></div></div>
  <nav id="nav">
    <button class="nav-item active" data-page="geral"><span class="ico">📊</span><span class="txt">Visão Geral</span></button>
    <button class="nav-item" data-page="enviar"><span class="ico">📨</span><span class="txt">Enviar Mensagem</span></button>
    <button class="nav-item" data-page="servicos"><span class="ico">⏱️</span><span class="txt">Serviços</span></button>
    <button class="nav-item" data-page="guarda"><span class="ico">🛡️</span><span class="txt">Guarda do Vênus</span></button>
    <button class="nav-item" data-page="erros"><span class="ico">🩸</span><span class="txt">Erros & Incidências</span></button>
    <button class="nav-item" data-page="atividade"><span class="ico">📜</span><span class="txt">Atividade</span></button>
  </nav>
  <div class="side-foot" id="clock">—</div>
</aside>

<main>
<header>
  <span class="dot" id="dot"></span>
  <span id="statusTxt">conectando…</span>
  <span class="spacer"></span>
  <span class="chip">auto-refresh <b id="refreshCount">10</b>s</span>
</header>

<!-- VISÃO GERAL -->
<section class="page active" id="pg-geral"><div class="pad">
  <div class="grid2">
    <div class="card">
      <h2>🧠 Modo / Fast brain (.env)</h2>
      <div class="linha"><select id="fb"></select><button onclick="setModo('KIMI_ADAPTER_MODE',document.getElementById('fb').value)">Aplicar</button></div>
      <div class="linha"><label class="dim fix" style="width:88px">Live brain</label>
        <select id="lb"><option value="kimi">kimi</option><option value="kimiwork">kimiwork</option></select>
        <button onclick="setModo('LIVE_BRAIN_PROVIDER',document.getElementById('lb').value)">Aplicar</button></div>
      <div class="linha"><label class="dim fix" style="width:88px">🪐 Vênus autônomo</label>
        <select id="va"><option value="true">ligado</option><option value="false">desligado</option></select>
        <button onclick="setModo('VENUS_AUTONOMO',document.getElementById('va').value)">Aplicar</button></div>
      <div class="dim hint" id="modoAtual"></div>
    </div>
    <div class="card">
      <h2>🔌 Validação de APIs</h2>
      <div id="checks"><div class="skel-wrap"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton" style="width:70%"></div></div></div>
    </div>
  </div>
  <div class="card">
    <h2>⏱️ Serviços (resumo)</h2>
    <div id="svcResumo"><div class="skel-wrap"><div class="skeleton"></div><div class="skeleton" style="width:60%"></div></div></div>
    <div class="hint">countdown completo na aba <b>Serviços</b> — rotulado como ESTIMATIVA</div>
  </div>
</div></section>

<!-- ENVIAR -->
<section class="page" id="pg-enviar"><div class="pad">
  <div class="card">
    <h2>📨 Enviar mensagem — pipeline oficial (messages + luna_outbound)</h2>
    <div class="linha"><select id="chat"></select><input id="chatManual" placeholder="…ou chat_id manual" style="max-width:240px"></div>
    <textarea id="texto" rows="6" placeholder="Mensagem… (guard-rail ativo: sem promessa de prazo — máx 900 chars)"></textarea>
    <div class="charcount" id="charCount">0 / 900</div>
    <div class="linha" style="margin-top:8px">
      <button onclick="enviar('luna')">Enviar como Luna</button>
      <button class="ghost" onclick="enviar('agent:venus')">Enviar como Vênus 🪐</button>
      <span class="dim" id="envStatus"></span>
    </div>
  </div>
</div></section>

<!-- SERVIÇOS -->
<section class="page" id="pg-servicos"><div class="pad">
  <div class="card">
    <h2>⏱️ Serviços & próximo beat <span class="badge">ESTIMATIVA</span></h2>
    <div id="servicos"><div class="skel-wrap"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton" style="width:55%"></div></div></div>
  </div>
</div></section>

<!-- GUARDA DO VÊNUS -->
<section class="page" id="pg-guarda"><div class="pad">
  <div class="card">
    <h2>🛡️ Guarda da irmã maior — supervisão do Vênus (crítico por regras, zero tokens)</h2>
    <div id="supervisao"><div class="skel-wrap"><div class="skeleton"></div><div class="skeleton" style="width:80%"></div></div></div>
  </div>
</div></section>

<!-- ERROS -->
<section class="page" id="pg-erros"><div class="pad">
  <div class="grid2">
    <div class="card">
      <h2>🩸 Incidências (48h)</h2>
      <div id="incidencias"><div class="skel-wrap"><div class="skeleton"></div><div class="skeleton" style="width:65%"></div></div></div>
    </div>
    <div class="card">
      <h2>🩸 Últimas linhas de erro (logs pm2)</h2>
      <div id="logErros" style="max-height:520px;overflow:auto"><div class="skel-wrap"><div class="skeleton"></div><div class="skeleton" style="width:75%"></div></div></div>
    </div>
  </div>
</div></section>

<!-- ATIVIDADE -->
<section class="page" id="pg-atividade"><div class="pad">
  <div class="card">
    <h2>📜 Atividade recente — responder de novo com contexto</h2>
    <div id="atividade"><div class="skel-wrap"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton" style="width:70%"></div></div></div>
  </div>
</div></section>
</main>

<div id="toast"></div>

<script>
// ── estado: assinaturas pra refresh cirúrgico (só re-renderiza o que mudou) ──
const SIG = { status: '', atividade: '', supervisao: '', erros: '' };
const OPEN_CTX = {};              // conversation_id -> true (mantém details aberto entre refreshes)
const CTX_CACHE = {};             // conversation_id -> html do contexto (não refetch)
const BEAT = { orchestrator: 30, worker: 30, watchdog: 30, whatsplay: 15 };
let lastStatus = null, refreshing = false, tick = 10;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function toast(msg, erro) {
  const t = $('toast'); t.textContent = msg;
  t.style.borderColor = erro ? 'var(--erro)' : 'var(--ok)';
  t.style.display = 'block'; clearTimeout(t._h);
  t._h = setTimeout(() => t.style.display = 'none', 4000);
}

// ── navegação SPA ──
$('nav').addEventListener('click', e => {
  const b = e.target.closest('.nav-item'); if (!b) return;
  document.querySelectorAll('.nav-item').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'pg-' + b.dataset.page));
});

// ── renderers (cada um só toca o DOM se a assinatura mudou) ──
function renderStatus(s) {
  const sig = JSON.stringify([s.modo, s.checks, s.servicos.map(v => [v.service, v.pid, v.stale, v.estado])]);
  if (sig === SIG.status) return; SIG.status = sig;
  lastStatus = s;
  $('dot').className = 'dot ' + (s.checks.postgres.ok ? 'on' : 'off');
  $('statusTxt').textContent = s.checks.postgres.ok ? 'Luna online' : 'Postgres fora — verifique';
  $('modoAtual').textContent = 'atual: fast brain=' + s.modo.KIMI_ADAPTER_MODE + ' · live=' + s.modo.LIVE_BRAIN_PROVIDER + ' · vênus=' + s.modo.VENUS_AUTONOMO;
  const fb = $('fb');
  if (!fb.options.length) s.modos.forEach(m => fb.add(new Option(m, m)));
  fb.value = s.modo.KIMI_ADAPTER_MODE;
  $('lb').value = s.modo.LIVE_BRAIN_PROVIDER;
  $('va').value = s.modo.VENUS_AUTONOMO;
  // chats (select + manual) — preserva seleção e o que foi digitado
  const sel = $('chat'), atual = sel.value, manual = $('chatManual').value.trim();
  let html = s.chats.map(c => '<option value="' + esc(c.chat_id) + '">' + esc(c.chat_id) + '  (' + c.n + ' msgs)</option>').join('');
  if (manual) html += '<option value="' + esc(manual) + '">' + esc(manual) + '  (manual)</option>';
  if (sel.dataset.sig !== html) {
    sel.innerHTML = html; sel.dataset.sig = html;
    if ([...sel.options].some(o => o.value === atual)) sel.value = atual;
  }
  // checks
  $('checks').innerHTML = Object.entries(s.checks).map(([k, v]) =>
    '<div class="check"><span><span class="mini-dot" style="background:' + (v.ok ? 'var(--ok)' : 'var(--erro)') + '"></span>' + esc(k) + '</span><span class="dim">' + esc(v.detalhe) + '</span></div>').join('');
  // serviços (página própria) + resumo
  $('servicos').innerHTML = s.servicos.map(v => {
    const iv = BEAT[v.service] || 30;
    const pct = v.next_beat_s != null ? Math.max(0, Math.min(100, Math.round((1 - v.next_beat_s / iv) * 100))) : 0;
    return '<div class="svc' + (v.stale ? ' stale' : '') + '">' +
      '<div class="top"><b>' + esc(v.service) + '</b><span class="dim">pid ' + esc(String(v.pid)) + '</span>' +
      '<span class="' + (v.stale ? 'erro' : 'ok') + '" style="font-size:12px">' + (v.stale ? 'PARADO há ' + v.age_s + 's' : 'vivo há ' + v.age_s + 's') + '</span>' +
      '<span class="badge">' + esc(String(v.estado)) + '</span></div>' +
      (v.next_beat_s != null ? '<div class="dim" style="font-size:11.5px">próximo beat estimado em ' + v.next_beat_s + 's</div><div class="barra"><div style="width:' + pct + '%" data-svc="' + esc(v.service) + '"></div></div>' : '') +
      '</div>';
  }).join('') || '<div class="empty">sem heartbeats ainda</div>';
  $('svcResumo').innerHTML = s.servicos.map(v =>
    '<div class="check"><span><span class="mini-dot" style="background:' + (v.stale ? 'var(--erro)' : 'var(--ok)') + '"></span>' + esc(v.service) + '</span><span class="dim">' + (v.stale ? 'PARADO há ' + v.age_s + 's' : 'ok · ' + esc(String(v.estado))) + '</span></div>').join('') || '<div class="empty">—</div>';
}
// countdown 1s: só move as barras, sem re-render
setInterval(() => {
  if (!lastStatus) return;
  const now = Date.now();
  for (const v of lastStatus.servicos) {
    const bar = document.querySelector('[data-svc="' + v.service + '"]');
    if (!bar) continue;
    const iv = BEAT[v.service] || 30;
    const next = Math.max(0, iv - (Math.round((now - 0) / 1000) - v.age_s - (v.next_beat_s != null ? (iv - v.age_s - v.next_beat_s) : 0)));
    const pct = Math.max(0, Math.min(100, Math.round((1 - next / iv) * 100)));
    bar.style.width = pct + '%';
  }
}, 1000);

function renderAtividade(a) {
  const sig = JSON.stringify(a.map(m => [m.id, m.send_state]));
  if (sig === SIG.atividade) { syncAtividadeDom(a); return; }
  SIG.atividade = sig;
  $('atividade').innerHTML = a.map(m =>
    '<div class="item" data-conv="' + esc(m.conversation_id) + '">' +
    '<div class="meta"><b>' + esc(m.sender) + '</b><span>→</span><span>' + esc(m.chat_id) + '</span><span>·</span><span>' + new Date(m.created_at).toLocaleString('pt-BR') + '</span>' +
    '<span class="badge ' + (m.send_state === 'sent' ? 'ok' : 'erro') + '">' + esc(m.send_state) + '</span></div>' +
    '<div class="body">' + esc(m.body) + '</div>' +
    '<details ' + (OPEN_CTX[m.conversation_id] ? 'open' : '') + '><summary>contexto + responder de novo</summary>' +
    '<div class="ctx" data-conv="' + esc(m.conversation_id) + '">' + (CTX_CACHE[m.conversation_id] || '<span class="dim">carregando…</span>') + '</div>' +
    '<div class="linha" style="margin-top:6px"><input class="re-chat" value="' + esc(m.chat_id) + '"><button class="ghost" onclick="responderDnv(this)">Responder com contexto</button></div>' +
    '</details></div>'
  ).join('') || '<div class="empty">sem atividade</div>';
  document.querySelectorAll('#atividade details').forEach(d => d.addEventListener('toggle', () => {
    const conv = d.closest('.item').dataset.conv;
    OPEN_CTX[conv] = d.open;
    if (d.open) carregarCtx(conv, d.querySelector('.ctx'));
  }));
}
// atualiza badges de send_state sem destruir a lista (preserva details abertos)
function syncAtividadeDom(a) {
  a.forEach(m => {
    const item = document.querySelector('#atividade .item[data-conv="' + m.conversation_id + '"]');
    if (!item) return;
    const b = item.querySelector('.badge');
    if (b && b.textContent !== m.send_state) { b.textContent = m.send_state; b.className = 'badge ' + (m.send_state === 'sent' ? 'ok' : 'erro'); }
  });
}
async function carregarCtx(conv, el) {
  if (CTX_CACHE[conv]) { el.innerHTML = CTX_CACHE[conv]; return; }
  const c = await api('/api/contexto?conversation_id=' + conv);
  CTX_CACHE[conv] = c.contexto.map(m => '<span class="meta">[' + esc(m.direction) + '/' + esc(m.sender) + '] ' + esc(m.body) + '</span>').join('') || '<span class="dim">sem contexto</span>';
  el.innerHTML = CTX_CACHE[conv];
}

function renderSupervisao(list) {
  const sig = JSON.stringify(list.map(v => [v.id, v.luna_verdict, v.flagged]));
  if (sig === SIG.supervisao) return; SIG.supervisao = sig;
  $('supervisao').innerHTML = list.map(v =>
    '<div class="item"><div class="meta"><b>' + esc(v.chat_id) + '</b><span>·</span><span>' + new Date(v.created_at).toLocaleString('pt-BR') + '</span>' +
    '<span class="' + (v.flagged ? 'erro' : 'ok') + '">' + (v.flagged ? 'FLAG: ' + esc((v.critic?.reasons ?? []).join('; ')) : 'passou no crítico') + '</span>' +
    (v.luna_verdict ? '<span>· veredito: <b>' + esc(v.luna_verdict) + '</b></span>' : '<span class="dim">· aguardando a Luna</span>') + '</div>' +
    '<div class="body">' + esc(v.body) + '</div>' +
    (v.luna_action ? '<div class="meta" style="margin-top:4px">ação da Luna: ' + esc(v.luna_action) + '</div>' : '') + '</div>'
  ).join('') || '<div class="empty">nenhuma mensagem dele avaliada ainda</div>';
}

function renderErros(ve) {
  const sig = JSON.stringify([(ve.incidencias ?? []).map(i => [i.id, i.motivo]), (ve.log ?? []).map(l => l.linha)]);
  if (sig === SIG.erros) return; SIG.erros = sig;
  $('incidencias').innerHTML = (ve.incidencias ?? []).map(v =>
    '<div class="item"><div class="meta"><b>' + esc(v.kind) + '</b><span>·</span><span>' + new Date(v.received_at).toLocaleString('pt-BR') + '</span><span class="badge erro">error</span>' +
    (v.por ? '<span>· por: ' + esc(v.por) + '</span>' : '') + '</div>' +
    '<div class="body">' + esc(v.motivo ?? '(sem motivo registrado)') + '</div></div>').join('') || '<div class="empty">sem incidências em 48h</div>';
  $('logErros').innerHTML = (ve.log ?? []).map(v =>
    '<div class="logline"><span class="fonte-tag">' + esc(v.fonte) + '</span>' + esc(v.linha) + '</div>').join('') || '<div class="empty">sem erros no log</div>';
}

// ── ações ──
async function api(p, opt) {
  const r = await fetch(p, opt);
  if (!r.ok) { let j = {}; try { j = await r.json(); } catch {} throw new Error(j.erro || ('HTTP ' + r.status)); }
  return r.json();
}
async function setModo(key, value) {
  try {
    await api('/api/modo', { method: 'POST', body: JSON.stringify({ key, value }) });
    toast(key + ' = ' + value + ' gravado no .env ✅');
    SIG.status = ''; refresh();
  } catch (e) { toast('ERRO: ' + e.message, true); }
}
async function enviar(sender) {
  const manual = $('chatManual').value.trim();
  const chatId = manual || $('chat').value;
  const btn = event.target; btn.disabled = true;
  try {
    await api('/api/enviar', { method: 'POST', body: JSON.stringify({ chat_id: chatId, texto: $('texto').value, sender }) });
    $('envStatus').textContent = 'enfileirada ✅';
    $('texto').value = ''; updateCharCount();
    toast('mensagem enfileirada — send via pipeline oficial');
    SIG.atividade = ''; refresh();
  } catch (e) {
    $('envStatus').textContent = 'ERRO: ' + e.message;
    toast('ERRO: ' + e.message, true);
  } finally { btn.disabled = false; }
}
function responderDnv(btn) {
  const item = btn.closest('.item');
  const conv = item.dataset.conv;
  const body = item.querySelector('.body').textContent;
  const chatInput = item.querySelector('.re-chat');
  $('chatManual').value = chatInput.value;
  const ctxEl = item.querySelector('.ctx');
  const ctx = ctxEl ? [...ctxEl.querySelectorAll('.meta')].map(x => x.textContent).join('\n') : '';
  $('texto').value = '[contexto da conversa]\n' + ctx.slice(-2000) + '\n\n[última msg nossa]\n' + body + '\n\n[nova resposta]\n';
  updateCharCount();
  document.querySelector('[data-page="enviar"]').click();
  toast('compositor carregado com contexto — edite e envie');
}
function updateCharCount() {
  const n = $('texto').value.length;
  $('charCount').textContent = n + ' / 900';
  $('charCount').className = 'charcount' + (n > 900 ? ' over' : '');
}
$('texto').addEventListener('input', updateCharCount);
$('chatManual').addEventListener('change', () => {
  const v = $('chatManual').value.trim();
  if (v && ![...$('chat').options].some(o => o.value === v)) {
    $('chat').add(new Option(v + '  (manual)', v));
  }
});

// ── refresh com guard (sem requests sobrepostos) + countdown visível ──
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const [s, a, sup, ve] = await Promise.all([
      api('/api/status'), api('/api/atividade'),
      api('/api/venus-supervision'), api('/api/venus-erros'),
    ]);
    renderStatus(s); renderAtividade(a.atividade);
    renderSupervisao(sup.supervisao); renderErros(ve);
    $('dot').className = 'dot on'; $('statusTxt').textContent = 'Luna online';
  } catch (e) {
    $('dot').className = 'dot off'; $('statusTxt').textContent = 'painel-backend fora: ' + e.message;
  } finally { refreshing = false; }
}
setInterval(() => { tick--; if (tick <= 0) { tick = 10; refresh(); } $('refreshCount').textContent = tick; }, 1000);
setInterval(() => $('clock').textContent = new Date().toLocaleString('pt-BR'), 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

refresh();
</script>
</body>
</html>`;

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[painel-luna] no ar em http://127.0.0.1:${PORT} (só localhost) — v2`);
});

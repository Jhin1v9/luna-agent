// luna-whatsapp-shim — Baileys (WhatsApp headless) + shim REST :3599
// Rotas próprias: /api/whatsapp/send | /status (com qr) | /paircode
// Todo o resto de /api/* vira proxy reverso pro painel Nexo (:3500).
import http from 'node:http';
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';

const PORT = Number(process.env.PORT || 3599);
const TOKEN = process.env.INTERNAL_API_TOKEN || '';
const PANEL = process.env.PANEL_URL || 'http://127.0.0.1:3500';
const AUTH_DIR = process.env.AUTH_DIR || '/app/auth';

const logger = pino({ level: 'silent' });
const state = { status: 'starting', phone: null, pairingCode: null, pairingAt: 0, qr: null };
let sock = null;
let connectAttempt = 0;

function log(...a) { console.log(new Date().toISOString(), ...a); }

async function connect(phoneForPairing = null) {
  connectAttempt++;
  const attempt = connectAttempt;
  try {
    const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const wa = makeWASocket({ auth: authState, logger, printQRInTerminal: false });
    sock = wa;
    state.status = 'connecting';

    wa.ev.on('creds.update', saveCreds);
    wa.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect, qr } = u;
      if (qr) { state.qr = qr; state.status = 'qr_pending'; log('[WA] QR atualizado'); }
      if (connection === 'open') {
        state.status = 'connected';
        state.phone = wa.user?.id?.split(':')[0] || null;
        state.qr = null;
        state.pairingCode = null;
        log('[WA] conectado como', state.phone);
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        log('[WA] desconectado. code=', code, code === DisconnectReason.loggedOut ? '(LOGGED OUT)' : '(reconectando)');
        if (sock === wa) sock = null;
        state.qr = null;
        state.status = code === DisconnectReason.loggedOut ? 'logged_out' : 'disconnected';
        if (state.status !== 'logged_out' && attempt === connectAttempt) {
          setTimeout(() => connect(), 8000);
        }
      }
    });

    if (phoneForPairing && !authState.creds.registered) {
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (state.status === 'connected' || sock !== wa) return;
        try {
          const code = await wa.requestPairingCode(phoneForPairing.replace(/\D/g, ''));
          state.pairingCode = code;
          state.pairingAt = Date.now();
          log('[WA] pairing code gerado:', code);
          return;
        } catch { /* ainda não pronto — tenta de novo */ }
      }
    }
  } catch (e) {
    log('[WA] erro no connect:', e.message);
    state.status = 'error';
    if (attempt === connectAttempt) setTimeout(() => connect(), 10000);
  }
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function authorized(req) {
  if (!TOKEN) return true;
  const h = req.headers.authorization || '';
  return h === `Bearer ${TOKEN}` || h === TOKEN;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (path === '/api/whatsapp/status') {
    return sendJson(res, 200, {
      success: true,
      status: state.status,
      phone: state.phone,
      qr: state.qr || null,
      pairingCode: state.pairingCode && Date.now() - state.pairingAt < 120000 ? state.pairingCode : null,
    });
  }

  if (path === '/api/whatsapp/qr') {
    // página HTML com o QR pra escanear (só funciona se ainda não conectado)
    if (!state.qr) return sendJson(res, 404, { success: false, error: 'Sem QR ativo (status: ' + state.status + ')' });
    const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=' + encodeURIComponent(state.qr);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Luna WhatsApp</title>
<style>body{font-family:sans-serif;background:#111;color:#eee;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0}
img{background:#fff;padding:16px;border-radius:12px}p{color:#aaa}</style></head>
<body><h2>Escaneia com o WhatsApp da Luna</h2><img src="${qrUrl}" width="320" height="320">
<p>WhatsApp → Aparelhos conectados → Conectar aparelho</p>
<script>setTimeout(()=>location.reload(),20000)</script></body></html>`);
  }

  if (path === '/api/whatsapp/paircode') {
    if (!authorized(req)) return sendJson(res, 401, { success: false, error: 'Não autorizado' });
    if (state.status === 'connected') return sendJson(res, 400, { success: false, error: 'Já conectado' });
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const phone = (body.phone || '').replace(/\D/g, '');
    if (!phone) return sendJson(res, 400, { success: false, error: 'phone obrigatório (DDI+DDD+numero)' });
    if (state.pairingCode && Date.now() - state.pairingAt < 60000) {
      return sendJson(res, 200, { success: true, pairingCode: state.pairingCode, expiresInSec: Math.round((60000 - (Date.now() - state.pairingAt)) / 1000) });
    }
    state.pairingCode = null;
    await connect(phone);
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (state.pairingCode) return sendJson(res, 200, { success: true, pairingCode: state.pairingCode, expiresInSec: 60 });
      if (state.status === 'connected') return sendJson(res, 200, { success: true, alreadyConnected: true, phone: state.phone });
    }
    return sendJson(res, 504, { success: false, error: 'Timeout aguardando pairing code' });
  }

  if (path === '/api/whatsapp/send') {
    if (!authorized(req)) return sendJson(res, 401, { success: false, error: 'Não autorizado' });
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const phone = String(body.phone || body.chatId || '').replace(/\D/g, '');
    const message = body.message || body.text || '';
    if (!phone || !message) return sendJson(res, 400, { success: false, error: 'phone e message obrigatórios' });
    if (!sock || state.status !== 'connected') {
      return sendJson(res, 503, { success: false, error: `WhatsApp não conectado (status: ${state.status})` });
    }
    try {
      await sock.sendMessage(`${phone}@s.whatsapp.net`, { text: message });
      log('[WA] enviado para', phone);
      return sendJson(res, 200, { success: true });
    } catch (e) {
      return sendJson(res, 500, { success: false, error: e.message });
    }
  }

  // ── fallback: proxy reverso pro painel ──
  try {
    const body = await readBody(req);
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];
    const proxyReq = http.request(`${PANEL}${path}${url.search}`, { method: req.method, headers }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (e) => sendJson(res, 502, { success: false, error: 'Painel indisponível: ' + e.message }));
    if (body.length) proxyReq.write(body);
    proxyReq.end();
  } catch (e) {
    sendJson(res, 500, { success: false, error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => log(`[SHIM] ouvindo em 127.0.0.1:${PORT} → painel ${PANEL}`));
connect();

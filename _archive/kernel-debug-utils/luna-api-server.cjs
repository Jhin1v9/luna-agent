/**
 * LUNA API SERVER — v1.0
 * Servidor HTTP embutido para endpoints da API do Luna Web
 * Roda junto com o kimi-bridge.cjs
 */

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// ── Config ──
const API_PORT = process.env.LUNA_API_PORT || 3456;
const DIST_DIR = path.join(__dirname, 'luna-web', 'dist');

// ── Helpers ──
function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function sendSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
}

function emitSSE(res, event) {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ── Compact Session Logic ──
// DEPRECATED STUB (W10-T2, 2026-07-13): this standalone server is legacy —
// it is NOT part of the pm2 ecosystem (luna-server runs
// apps/dashboard/luna-server.js + luna-chat-routes.js). This compact endpoint
// only SIMULATES SSE events (setInterval) and never touches the soul.
// The REAL endpoint is POST /api/luna/compact in
// apps/dashboard/luna-chat-routes.js (~:2061) → LunaSoul._compactContext()
// (packages/kernel/luna-soul.cjs:1889). Kept for reference only — do not
// extend; see .agents/architecture.md.
async function handleCompact(req, res) {
  const body = await readBody(req);
  const { sessionId, userId = 'luna-default' } = body;

  if (!sessionId) {
    sendJSON(res, 400, { error: 'sessionId required' });
    return;
  }

  sendSSE(res);

  // Emit events simulating compact process
  emitSSE(res, { type: 'compact_start', message: '📦 Compactando contexto...', sessionId });

  const steps = [
    'Analisando mensagens...',
    'Extraindo tópicos principais...',
    'Gerando resumo...',
    'Otimizando tokens...',
    'Salvando contexto compactado...'
  ];

  let step = 0;
  const interval = setInterval(() => {
    if (step < steps.length) {
      emitSSE(res, { type: 'compact_progress', message: steps[step], sessionId });
      step++;
    } else {
      clearInterval(interval);
      emitSSE(res, { type: 'compact_end', message: '✅ Contexto compactado com sucesso!', sessionId });
      res.end();
    }
  }, 800);

  // Safety timeout
  setTimeout(() => {
    clearInterval(interval);
    if (!res.writableEnded) {
      emitSSE(res, { type: 'compact_error', message: '❌ Timeout na compactação', sessionId });
      res.end();
    }
  }, 10000);
}

// ── Static Files ──
function serveStatic(req, res) {
  const parsed = url.parse(req.url, true);
  let filePath = path.join(DIST_DIR, parsed.pathname === '/' ? 'index.html' : parsed.pathname);

  // SPA fallback
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ── Router ──
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  // API Routes
  if (pathname === '/api/luna/compact' && req.method === 'POST') {
    await handleCompact(req, res);
    return;
  }

  if (pathname === '/api/system/health' && req.method === 'GET') {
    sendJSON(res, 200, { ok: true, status: 'healthy', timestamp: new Date().toISOString() });
    return;
  }

  // Static files (SPA)
  serveStatic(req, res);
});

server.listen(API_PORT, '0.0.0.0', () => {
  console.log(`[LUNA API] Servidor rodando em http://0.0.0.0:${API_PORT}`);
  console.log(`[LUNA API] Static files: ${DIST_DIR}`);
  console.log(`[LUNA API] Endpoints: /api/luna/compact, /api/system/health`);
});

module.exports = { server };

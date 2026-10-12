/**
 * Luna Chat Routes — Express router for Luna Web chat API
 * Adapted from config-server.cjs for integration into Dashboard server.js
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync, exec, execFileSync } = require('child_process');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('./db');
const JSZip = require('jszip');
const { resolveJwtSecret } = require('./config-validator');

// Wave 1 Fix B1: tool-instance-aware event dedup
const { makeEventDedupKey } = require('./lib/chat-event-dedup.cjs');
// Targeted service recovery via pm2 (canonical monorepo process names)
const selfheal = require('./lib/selfheal.cjs');

// v11.0: Centralized kernel resolution via shared resolver
const { LUNA_KERNEL_DIR } = require('./lib/resolve-luna.cjs');
console.log('[DEBUG-LUNA-RESOLVE-2] LUNA_KERNEL_DIR:', LUNA_KERNEL_DIR, 'SOUL_PATH:', path.join(LUNA_KERNEL_DIR, 'luna-soul.cjs'));
const config = require(path.join(LUNA_KERNEL_DIR, 'config', 'luna-config'));
const providerLoader = require(path.join(LUNA_KERNEL_DIR, 'provider-loader.cjs'));

// ============================================================
// Luna Soul lazy initialization
// ============================================================
const LUNA_DIR = LUNA_KERNEL_DIR;
const SOUL_PATH = path.join(LUNA_DIR, 'luna-soul.cjs');
const ENV_PATH = path.join(LUNA_DIR, '.env');
let lunaSoul = null;
let lunaReady = false;
// Wave 1 Fix B3: module-level sequence so event ids never collide on Date.now()
let eventSeq = 0;

async function getLunaSoul() {
  if (lunaSoul && lunaReady) return lunaSoul;
  try {
    const { LunaSoul } = require(SOUL_PATH);
    lunaSoul = new LunaSoul({});
    await lunaSoul.init();
    lunaReady = true;
    console.log('🧠 Luna Soul inicializado para web chat');

    // v8.0: Wire extension handler to LunaSoul for tool execution
    try {
      const expressApp = require('./luna-server').app || global.__lunaApp;
      if (expressApp && expressApp.locals && expressApp.locals.extensionHandler) {
        expressApp.locals.extensionHandler.setToolExecutor(async (tool, params, sessionId) => {
          // Map web session to Luna Soul session
          const webSessionId = sessionId?.replace('web-', '') || sessionId;
          const result = await lunaSoul._handleAction(
            { tool, params, mode: 'ACTION' },
            webSessionId,
            { userId: sessionId }
          );
          return result;
        });
        console.log('[LunaExt] Tool executor wired to Luna Soul');
      }
    } catch (e) {
      console.warn('[LunaExt] Failed to wire tool executor:', e.message);
    }

    return lunaSoul;
  } catch (e) {
    console.error('❌ Erro ao inicializar Luna Soul:', e.message);
    throw e;
  }
}

// ============================================================
// Web Chat Sessions — híbrido: memória + PostgreSQL
// ============================================================
const webSessions = new Map();
const activeStreams = new Map();
const sseConnections = new Map(); // sessionId -> Set of {res, keepAlive, checkInterval}

// v10.32: Local JSON fallback when PostgreSQL is unreachable.
const SESSIONS_FILE_PATH = path.join(__dirname, 'data', 'luna-chat-sessions.json');

function loadSessionsFromJson() {
  try {
    if (!fs.existsSync(SESSIONS_FILE_PATH)) return [];
    const raw = fs.readFileSync(SESSIONS_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('[JSON] Erro ao carregar sessões:', e.message);
    return [];
  }
}

function saveSessionsToJson(sessions) {
  try {
    const dir = path.dirname(SESSIONS_FILE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SESSIONS_FILE_PATH, JSON.stringify(sessions, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[JSON] Erro ao salvar sessões:', e.message);
  }
}

function upsertSessionInJson(session) {
  try {
    const sessions = loadSessionsFromJson();
    const idx = sessions.findIndex(s => s.id === session.id);
    if (idx >= 0) sessions[idx] = session;
    else sessions.push(session);
    saveSessionsToJson(sessions);
  } catch (e) {
    console.warn('[JSON] Erro ao atualizar sessão:', e.message);
  }
}

function removeSessionFromJson(id) {
  try {
    const sessions = loadSessionsFromJson().filter(s => s.id !== id);
    saveSessionsToJson(sessions);
  } catch (e) {
    console.warn('[JSON] Erro ao remover sessão:', e.message);
  }
}

// Periodic cleanup of orphaned activeStreams (e.g. client disconnect without close event)
setInterval(() => {
  const now = Date.now();
  const maxAge = config.TIMEOUTS.orphanStreamCleanup;
  for (const [id, meta] of activeStreams) {
    if (meta.createdAt && (now - meta.createdAt > maxAge)) {
      console.warn(`[WEB] Cleaning orphaned stream ${id} (age ${Math.round((now - meta.createdAt) / 1000)}s)`);
      activeStreams.delete(id);
    }
  }
}, 60000); // check every minute

async function dbRunWithRetry(sql, params, retries = 3) {
  if (!db.DB_ENABLED) {
    // PostgreSQL is not available; JSON fallback is the primary store.
    return null;
  }
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await db.run(sql, params);
    } catch (e) {
      lastErr = e;
      const delay = Math.min(1000 * Math.pow(2, i), 5000);
      console.warn(`[DB] Retry ${i + 1}/${retries} in ${delay}ms: ${e.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  console.error('[DB] Failed after retries:', lastErr.message);
  throw lastErr;
}

function generateWebSessionId() {
  return 'web-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

function createWebSession(title = 'Nova conversa', mode = 'instant', persona = 'default', id = null, provider = 'kimi') {
  const sessionId = id || generateWebSessionId();
  const session = {
    id: sessionId,
    title,
    mode,
    persona,
    provider,
    messages: [],
    eventLedger: [], // v10.13: Unacked events for reliable delivery
    lastAckedEventId: null, // v10.13: Last event ID acknowledged by frontend
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  webSessions.set(sessionId, session);
  // v10.32: Persistir no JSON fallback imediatamente (fonte primária quando DB indisponível).
  upsertSessionInJson(session);
  // Persistir no PostgreSQL (fire-and-forget with retry). Usa ON CONFLICT
  // para não falhar quando o client fornece um sessionId que já existe.
  dbRunWithRetry(
    `INSERT INTO luna_chat_sessions (id, user_id, title, mode, persona, provider, messages, event_ledger, last_acked_event_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
    [sessionId, 'anonymous', title, mode, persona, provider, JSON.stringify([]), JSON.stringify([]), null]
  ).catch(e => console.warn('[DB] Erro ao criar sessão (mantendo fallback JSON):', e.message));
  return session;
}

async function loadSessionFromDB(id) {
  // Try PostgreSQL first.
  try {
    const row = await db.get(
      `SELECT id, title, mode, persona, provider, messages, event_ledger, last_acked_event_id, created_at, updated_at
       FROM luna_chat_sessions WHERE id = $1`,
      [id]
    );
    if (row) {
      const session = {
        id: row.id,
        title: row.title,
        mode: row.mode,
        persona: row.persona || 'default',
        provider: row.provider || 'kimi',
        messages: Array.isArray(row.messages) ? row.messages : (typeof row.messages === 'string' ? JSON.parse(row.messages) : []),
        eventLedger: Array.isArray(row.event_ledger) ? row.event_ledger : (typeof row.event_ledger === 'string' ? JSON.parse(row.event_ledger) : []),
        lastAckedEventId: row.last_acked_event_id || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      webSessions.set(id, session);
      return session;
    }
  } catch (e) {
    console.warn('[DB] Erro ao carregar sessão do PG:', e.message);
  }

  // Fallback to JSON cache.
  try {
    const sessions = loadSessionsFromJson();
    const found = sessions.find(s => s.id === id);
    if (found) {
      webSessions.set(id, found);
      return found;
    }
  } catch (e) {
    console.warn('[JSON] Erro ao carregar sessão do JSON:', e.message);
  }
  return null;
}

function getWebSession(id) {
  return webSessions.get(id);
}

function deleteWebSession(id) {
  const stream = activeStreams.get(id);
  if (stream) {
    stream.cancelled = true;
    activeStreams.delete(id);
  }
  const result = webSessions.delete(id);
  // Deletar do JSON fallback.
  removeSessionFromJson(id);
  // Deletar do PostgreSQL (fire-and-forget with retry)
  dbRunWithRetry(
    `DELETE FROM luna_chat_sessions WHERE id = $1`,
    [id]
  ).catch(e => console.warn('[DB] Erro ao deletar sessão no PG:', e.message));
  return result;
}

function renameWebSession(id, title) {
  const session = webSessions.get(id);
  if (session) {
    session.title = title;
    session.updatedAt = new Date().toISOString();
    // Atualizar no JSON fallback.
    upsertSessionInJson(session);
    // Atualizar no PostgreSQL (fire-and-forget with retry)
    dbRunWithRetry(
      `UPDATE luna_chat_sessions SET title = $1, updated_at = NOW() WHERE id = $2`,
      [title, id]
    ).catch(e => console.warn('[DB] Erro ao renomear sessão no PG:', e.message));
    return true;
  }
  return false;
}

// v11.10-fix: keep only the last thinking_update snapshot per turn for persistence,
// but let the live session.messages stream every update to SSE.
function collapseThinkingUpdates(messages) {
  const out = [];
  for (const m of messages) {
    if (
      m.type === 'thinking_update' &&
      out.length > 0 &&
      out[out.length - 1].type === 'thinking_update' &&
      out[out.length - 1].messageId === m.messageId
    ) {
      out[out.length - 1] = m;
    } else {
      out.push(m);
    }
  }
  return out;
}

function addMessageToSession(sessionId, message, { persist = true } = {}) {
  const session = webSessions.get(sessionId);
  if (session) {
    // v11.10-fix: append every thinking_update snapshot so SSE sees each update
    // and the frontend bubble mirrors Kimi's reasoning as it grows. Storage bloat
    // is avoided by collapsing consecutive snapshots before JSON/DB persistence.
    session.messages.push(message);

    // v10.13: Add to event ledger for ACK-based reliable delivery
    if (!session.eventLedger) session.eventLedger = [];
    session.eventLedger.push(message);
    // Prune ledger if it grows too large (keep last 200 unacked)
    if (session.eventLedger.length > 200) {
      session.eventLedger = session.eventLedger.slice(-200);
    }
    session.updatedAt = new Date().toISOString();
    // Wave 4 review follow-up: action_progress chunks are ephemeral live output —
    // they stay in memory (live SSE + replay read from here) but skip the
    // per-event persistence below (a sync full-session JSON rewrite + PG UPDATE
    // per chunk was hundreds of writes per verbose command). They ride along on
    // the next real event's persistence instead.
    if (!persist) return;
    // v10.32: Persistir no JSON fallback imediatamente.
    // v11.10-fix: collapse consecutive thinking_update snapshots so storage stays compact.
    const messagesToPersist = collapseThinkingUpdates(session.messages);
    upsertSessionInJson({ ...session, messages: messagesToPersist });
    // Persistir no PostgreSQL (fire-and-forget with retry)
    // v10.16-fix: Also persist eventLedger so reconnects don't lose unacked events
    dbRunWithRetry(
      `UPDATE luna_chat_sessions SET messages = $1::jsonb, event_ledger = $2::jsonb, last_acked_event_id = $3, updated_at = NOW() WHERE id = $4`,
      [JSON.stringify(messagesToPersist), JSON.stringify(session.eventLedger), session.lastAckedEventId || null, sessionId]
    ).catch(e => console.warn('[DB] Erro ao salvar mensagem no PG:', e.message));
  }
}

// ============================================================
// .env I/O
// ============================================================
function readEnv() {
  const env = {};
  if (fs.existsSync(ENV_PATH)) {
    const content = fs.readFileSync(ENV_PATH, 'utf-8');
    content.split('\n').forEach(line => {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match) env[match[1]] = match[2];
    });
  }
  return env;
}

function writeEnv(env) {
  // Read existing env to preserve keys not in the payload
  const existing = readEnv();
  const merged = { ...existing, ...env };

  let content = '# Luna Kernel v5.0 — Environment Configuration\n';
  content += '# Generated by Luna Config Panel\n';
  content += '# NEXO DIGITAL S.L.\n\n';
  content += '# ── REQUIRED ──\n\n';
  const required = ['TELEGRAM_BOT_TOKEN', 'INTERNAL_API_TOKEN', 'JWT_SECRET'];
  const optional = [
    'KIMI_TIMEOUT', 'KIMI_MAX_PAGES', 'KIMI_IDLE_TIMEOUT',
    'KIMI_COOLDOWN_MS', 'KIMI_MAX_TYPE_LENGTH', 'KIMI_LOG_MAX_MB',
    'LUNA_COMPACT_THRESHOLD', 'LUNA_COMPACT_TOKEN_THRESHOLD',
    'LUNA_CHROME_PATH', 'LUNA_DEBUG', 'LUNA_CONFIG_PORT'
  ];

  required.forEach(key => {
    if (merged[key] !== undefined && merged[key] !== '') {
      content += `${key}=${merged[key]}\n`;
    }
  });

  content += '\n# ── OPTIONAL ──\n\n';
  optional.forEach(key => {
    if (merged[key] !== undefined && merged[key] !== '') {
      content += `${key}=${merged[key]}\n`;
    }
  });

  // Also preserve any other keys not in required/optional lists
  const knownKeys = new Set([...required, ...optional]);
  const extraKeys = Object.keys(merged).filter(k => !knownKeys.has(k));
  if (extraKeys.length > 0) {
    content += '\n# ── CUSTOM ──\n\n';
    extraKeys.forEach(key => {
      if (merged[key] !== undefined && merged[key] !== '') {
        content += `${key}=${merged[key]}\n`;
      }
    });
  }

  fs.writeFileSync(ENV_PATH, content, 'utf-8');
  return true;
}

function readSystemPrompt() {
  if (!fs.existsSync(SOUL_PATH)) return { found: false, content: '' };
  const content = fs.readFileSync(SOUL_PATH, 'utf-8');
  const match = content.match(/function buildSystemPrompt\(opts = \{\}\) \{[\s\S]*?return `([\s\S]*?)`;\s*\}\s*\/\/\s*==+\s*\/\/\s*JSON PARSER/);
  if (match) return { found: true, content: match[1] };
  const match2 = content.match(/function buildSystemPrompt\([\s\S]*?return `([\s\S]*?)`;\s*\}\s*const/);
  if (match2) return { found: true, content: match2[1] };
  return { found: false, content: '' };
}

function writeSystemPrompt(newPrompt) {
  if (!fs.existsSync(SOUL_PATH)) return false;
  let content = fs.readFileSync(SOUL_PATH, 'utf-8');
  const pattern = /(function buildSystemPrompt\(opts = \{\}\) \{[\s\S]*?return `)[\s\S]*?(`;\s*\}\s*\/\/\s*==+\s*\/\/\s*JSON PARSER)/;
  if (pattern.test(content)) {
    content = content.replace(pattern, '$1' + newPrompt + '$2');
    fs.writeFileSync(SOUL_PATH, content, 'utf-8');
    return true;
  }
  const pattern2 = /(function buildSystemPrompt\([\s\S]*?return `)[\s\S]*?(`;\s*\}\s*const)/;
  if (pattern2.test(content)) {
    content = content.replace(pattern2, '$1' + newPrompt + '$2');
    fs.writeFileSync(SOUL_PATH, content, 'utf-8');
    return true;
  }
  return false;
}

// ============================================================
// SSE helper
// ============================================================
// v10.13: SSE with id + retry for resilient reconnection
function sendSSE(res, event, data, options = {}) {
  const { id, retry = 3000 } = options;
  // v10.16-fix: Keep event: message for frontend compat (EventSource.onmessage).
  // The real event type is inside JSON data.type. When frontend migrates to
  // addEventListener per-type, switch this to event: ${event}
  res.write(`event: message\n`);
  if (id) res.write(`id: ${id}\n`);
  if (retry) res.write(`retry: ${retry}\n`);
  res.write(`data: ${JSON.stringify({ ...data, type: event })}\n\n`);
  // v10.16-fix: Flush immediately to prevent proxy buffering
  if (typeof res.flush === 'function') res.flush();
}

// ============================================================
// Chat Routes
// ============================================================

// POST /api/chat — send message
router.post('/api/chat', async (req, res) => {
  const { message, sessionId, mode = 'instant', files, messageId: clientMessageId } = req.body;
  if (!message) return res.status(400).json({ ok: false, error: 'message obrigatório' });

  let session = sessionId ? getWebSession(sessionId) : null;
  if (!session && sessionId) {
    session = await loadSessionFromDB(sessionId);
  }
  if (!session) {
    session = createWebSession(message.slice(0, 40), mode, 'default', sessionId || undefined);
  }
  session.mode = mode;

  // v5.3-fix: If message > 3KB, convert to .txt file to optimize Kimi input
  let finalMessage = message;
  let finalFiles = files || [];
  const messageBytes = Buffer.byteLength(message, 'utf8');
  if (messageBytes > 3072) {
    const tmpDir = path.join(require('os').tmpdir(), 'luna-txt-uploads');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, `message-${session.id || Date.now()}.txt`);
    fs.writeFileSync(tmpFile, message, 'utf8');
    const base64 = fs.readFileSync(tmpFile, 'base64');
    finalFiles = [...finalFiles, {
      name: 'message.txt',
      type: 'text/plain',
      size: messageBytes,
      data: `data:text/plain;base64,${base64}`,
    }];
    finalMessage = `[Arquivo anexado: message.txt (${messageBytes} bytes)]`;
    console.log(`[WEB] Message ${messageBytes} bytes converted to message.txt for session ${session.id}`);
    setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore cleanup errors */ } }, 60000);
  }

  // v6.1-fix: Use client-provided messageId for deduplication, or generate one
  const messageId = clientMessageId || ('msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));

  addMessageToSession(session.id, {
    id: 'msg-' + Date.now(),
    role: 'user',
    type: 'text',
    content: message, // original message in history
    files: finalFiles,
    clientId: messageId, // v13.0 (F3.4): echo the client-generated id for UUID dedup
    timestamp: new Date().toISOString(),
  });

  // v5.3-fix: Cancel any existing stream for this session before starting a new one.
  // If user sends a new message while Luna is still "thinking", we abort the old
  // stream so it doesn't block forever.
  const existingStream = activeStreams.get(session.id);
  if (existingStream) {
    existingStream.cancelled = true;
    try {
      const luna = await getLunaSoul();
      if (luna && luna.kimiBridge) {
        const userId = 'web-' + session.id;
        await luna.kimiBridge.cancelStream(userId);
        console.log(`[WEB] Cancelled previous stream for session ${session.id} before new message`);
      }
    } catch (e) {
      console.warn('[WEB] Failed to cancel previous stream:', e.message);
    }
  }

  const streamToken = (activeStreams.get(session.id)?.token || 0) + 1;
  const myStreamMeta = { cancelled: false, createdAt: Date.now(), messageId, token: streamToken };
  activeStreams.set(session.id, myStreamMeta);
  // W6-T8: new user message reopens a closed stream
  session._streamClosed = false;

  res.json({ ok: true, sessionId: session.id, status: 'processing' });

  // Process in background
  try {
    console.log('[DEBUG-LUNA-ROUTES] getting luna soul for session', session.id);
    const luna = await getLunaSoul();
    console.log('[DEBUG-LUNA-ROUTES] luna soul ready', !!luna, !!luna?.processMessageStream);
    const stream = luna.processMessageStream(finalMessage, {
      sessionId: session.id,
      userId: 'web-' + session.id,
      mode: ['instant', 'thinking'].includes(mode) ? mode : 'instant',
      persona: session.persona || 'default',
      provider: session.provider || 'kimi',
      files: finalFiles,
      messageId,
    });

    // Wave 11: dedup by event id only. Content-based dedup was swallowing
    // thinking updates and repeated response/tool events.
    const emittedEventIds = new Set();

    for await (const ev of stream) {
      // v10.16-fix: Check OUR captured meta, not activeStreams.get() which may return
      // a newer stream object if user sent a new message while this one runs.
      if (myStreamMeta.cancelled) break;

      // W6-T8: once the final done is persisted the stream is closed — drop
      // straggler events (late deltas from the backend) instead of persisting them.
      if (session._streamClosed) continue;

      // v10.35-fix: Ignore response_done intermediate events. LunaSoul emits both
      // response_done and done for the same turn; storing both creates duplicate
      // final messages in session history. The final 'done' event carries the
      // definitive result.response, so we let that be the only persisted final.
      if (ev.type === 'response_done') {
        continue;
      }

      // Wave 11: attach the turn messageId to every streamed event so the
      // frontend can reject stale events from previous turns.
      if (messageId && ev.messageId === undefined) {
        ev.messageId = messageId;
      }

      if (['response_delta', 'action_start', 'action_end', 'error', 'done', 'thinking_start', 'thinking_delta', 'thinking_update', 'login_required', 'system', 'context_limit', 'compact_start', 'compact_progress', 'compact_end', 'compact_error', 'assistant', 'plan_start', 'plan_step', 'plan_complete', 'plan_error', 'mode_detected', 'action_progress', 'confirmation_required'].includes(ev.type)) {
        // v4.0-fix: For 'done' events, capture the final response from ev.result.response or ev.response
        // Wave 1 Fix B5: 'error'/'system' events carry text in ev.error/ev.message, not ev.text
        const content = ev.type === 'done'
          ? (ev.result?.response || ev.response || ev.text || ev.fullResponse || '')
          : ev.type === 'assistant'
            ? (ev.response || ev.text || ev.fullResponse || '')
            : (ev.type === 'error' || ev.type === 'system' || ev.type === 'confirmation_required')
              ? (ev.message || ev.error || ev.text || ev.fullResponse || '')
              : (ev.fullText || ev.text || ev.fullResponse || '');

        // DEBUG: dedup temporarily disabled to verify thinking delivery.
        // Re-enabled carefully: only thinking_update is replaced in addMessageToSession.
        // const dedupKey = ev.id || `${ev.type}:${Date.now()}:${++eventSeq}`;
        // if (ev.type !== 'action_progress' && emittedEventIds.has(dedupKey)) {
        //   continue;
        // }
        // emittedEventIds.add(dedupKey);

        // v6.1-fix: Attach messageId so frontend can validate against stale events
        addMessageToSession(session.id, {
          id: 'ev-' + Date.now() + '-' + (++eventSeq), // Wave 1 Fix B3: unique ids
          role: 'assistant',
          type: ev.type,
          content: content,
          fullThinking: ev.fullThinking || undefined,
          tool: ev.tool,
          toolInstanceId: ev.toolInstanceId || undefined, // Wave 1 Fix B2
          confirmationId: ev.confirmationId || undefined, // v3.3: destructive op confirmation gate
          chunk: ev.chunk || undefined, // Wave 4 Fix: live tool output
          params: ev.params,
          result: ev.result,
          messageId: messageId,
          timestamp: new Date().toISOString(),
        }, { persist: ev.type !== 'action_progress' }); // Wave 4 review follow-up: chunks ride the next event's persistence

        // W6-T8: close the stream once the final done is persisted — any
        // straggler events after this are dropped by the gate above.
        if (ev.type === 'done') session._streamClosed = true;
      }
    }
  } catch (e) {
    console.error('[WEB] Erro no processamento:', e.message);
    console.error('[WEB] Stack:', e.stack);
    const isLoginRequired = e.message === 'KIMI_LOGIN_REQUIRED' || e.message?.includes('login');
    addMessageToSession(session.id, {
      id: 'err-' + Date.now(),
      role: 'assistant',
      type: isLoginRequired ? 'login_required' : 'error',
      content: isLoginRequired
        ? 'Sessão do Kimi expirada. Por favor, faça login novamente no Chrome e recarregue a página.'
        : e.message,
      timestamp: new Date().toISOString(),
    });
  } finally {
    // v10.16-fix: Use session.id (guaranteed) instead of raw sessionId which may be undefined
    const finalSessionId = session.id;
    // v5.7-fix: Guarantee a final event so frontend knows streaming is done
    const finalSession = getWebSession(finalSessionId);
    if (finalSession) {
      const hasFinalEvent = finalSession.messages.some(m =>
        m.type === 'done' || m.type === 'error' || m.type === 'login_required' || m.type === 'context_limit'
      );
      if (!hasFinalEvent) {
        addMessageToSession(finalSessionId, {
          id: 'done-' + Date.now(),
          role: 'assistant',
          type: 'done',
          content: '',
          result: { response: '' },
          timestamp: new Date().toISOString(),
        });
      }
    }
    // W6-T8 review: only delete the stream meta if it is still OURS — a newer
    // POST may have already replaced it, and deleting theirs would let a third
    // POST run concurrently (its events then hitting the closed gate).
    if (activeStreams.get(finalSessionId) === myStreamMeta) {
      activeStreams.delete(finalSessionId);
    }
  }
});

// GET /api/chat/stream — SSE streaming (v10.13: resilient reconnection with Last-Event-ID + ledger replay)
router.get('/api/chat/stream', async (req, res) => {
  const sessionId = req.query.sessionId;
  if (!sessionId) {
    return res.status(400).send('sessionId obrigatório');
  }

  // Garantir que a sessão está carregada na memória
  let currentSession = getWebSession(sessionId);
  if (!currentSession) {
    currentSession = await loadSessionFromDB(sessionId);
  }
  if (!currentSession) {
    return res.status(404).send('Sessão não encontrada');
  }

  // v4.1-fix: Close existing SSE connections for this session to prevent duplicates
  const existingConnections = sseConnections.get(sessionId);
  if (existingConnections) {
    console.log(`[SSE] Closing ${existingConnections.size} existing connection(s) for session ${sessionId}`);
    for (const conn of existingConnections) {
      clearInterval(conn.keepAlive);
      clearInterval(conn.checkInterval);
      try {
        conn.res.end();
      } catch (e) {
        // ignore
      }
    }
    sseConnections.delete(sessionId);
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });

  // v10.13: Read Last-Event-ID header for reconnection resume
  const lastEventId = req.headers['last-event-id'];
  let replayedCount = 0;

  // v10.13: Replay missed events from ledger before starting live polling
  if (lastEventId && currentSession.eventLedger && currentSession.eventLedger.length > 0) {
    const ledger = currentSession.eventLedger;
    const lastIdx = ledger.findIndex(ev => ev.id === lastEventId);
    const startIdx = lastIdx >= 0 ? lastIdx + 1 : 0;
    const missedEvents = ledger.slice(startIdx);

    if (missedEvents.length > 0) {
      console.log(`[SSE] Reconnect session ${sessionId}: replaying ${missedEvents.length} missed events after ${lastEventId}`);
      for (const msg of missedEvents) {
        const eventData = {
          id: msg.id,
          type: msg.type,
          role: msg.role,
          sessionId,
          timestamp: msg.timestamp,
        };
        if (msg.content) eventData.text = msg.content;
        if (msg.content) eventData.fullResponse = msg.content;
        if (msg.content) eventData.response = msg.content;
        // v11.8-fix: thinking_update carries the full reasoning text in fullText
        // so the frontend replaces the bubble content instead of treating it as a delta.
        if (msg.type === 'thinking_update') eventData.fullText = msg.content;
        if (msg.fullThinking) eventData.fullThinking = msg.fullThinking;
        if (msg.tool) eventData.tool = msg.tool;
        if (msg.params) eventData.params = msg.params;
        if (msg.result) eventData.result = msg.result;
        if (msg.plan) eventData.plan = msg.plan; // Wave 7: plan card content
        if (msg.planPath) eventData.planPath = msg.planPath; // Wave 7: plan file path
        if (msg.messageId) eventData.messageId = msg.messageId;
        if (msg.toolInstanceId) eventData.toolInstanceId = msg.toolInstanceId; // Wave 1 Fix B2
        if (msg.confirmationId) eventData.confirmationId = msg.confirmationId; // v12.0-fix: botão Confirmar precisa do id
        if (msg.chunk) eventData.chunk = msg.chunk; // Wave 4 Fix: live tool output
        if (msg.type === 'error') eventData.error = msg.content;
        if (msg.type === 'system') eventData.message = msg.content; // Wave 1 Fix B5
        if (msg.type === 'confirmation_required') eventData.message = msg.content; // v12.0-fix: texto do pedido de confirmação
        if (msg.role === 'user') {
          eventData.content = msg.content;
          if (msg.files && msg.files.length > 0) eventData.files = msg.files;
          if (msg.clientId) eventData.clientId = msg.clientId; // v13.0 (F3.4)
        }
        sendSSE(res, msg.type, eventData, { id: msg.id });
        replayedCount++;
      }
    }
  }

  // Send connected event with replay info
  sendSSE(res, 'connected', { type: 'connected', sessionId, replayed: replayedCount });

  const keepAlive = setInterval(() => {
    res.write(':keepalive\n\n');
  }, 15000);

  let lastMsgIndex = currentSession.messages.length; // Start from current position, not beginning

  const checkInterval = setInterval(() => {
    const session = getWebSession(sessionId);
    if (!session) {
      // Sessão foi removida da memória, tenta recarregar
      return;
    }

    const newMessages = session.messages.slice(lastMsgIndex);
    for (const msg of newMessages) {
      const eventData = {
        id: msg.id,
        type: msg.type,
        role: msg.role,
        sessionId,
        timestamp: msg.timestamp,
      };
      if (msg.content) eventData.text = msg.content;
      if (msg.content) eventData.fullResponse = msg.content;
      if (msg.content) eventData.response = msg.content;
      // v11.8-fix: thinking_update carries the full reasoning text in fullText
      // so the frontend replaces the bubble content instead of treating it as a delta.
      if (msg.type === 'thinking_update') eventData.fullText = msg.content;
      if (msg.fullThinking) eventData.fullThinking = msg.fullThinking;
      if (msg.tool) eventData.tool = msg.tool;
      if (msg.params) eventData.params = msg.params;
      if (msg.result) eventData.result = msg.result;
      if (msg.plan) eventData.plan = msg.plan; // Wave 7: plan card content
      if (msg.planPath) eventData.planPath = msg.planPath; // Wave 7: plan file path
      if (msg.messageId) eventData.messageId = msg.messageId;
      if (msg.toolInstanceId) eventData.toolInstanceId = msg.toolInstanceId; // Wave 1 Fix B2
      if (msg.confirmationId) eventData.confirmationId = msg.confirmationId; // v12.0-fix: botão Confirmar precisa do id
      if (msg.chunk) eventData.chunk = msg.chunk; // Wave 4 Fix: live tool output
      if (msg.type === 'error') eventData.error = msg.content;
      if (msg.type === 'system') eventData.message = msg.content; // Wave 1 Fix B5
      if (msg.type === 'confirmation_required') eventData.message = msg.content; // v12.0-fix: texto do pedido de confirmação
      if (msg.role === 'user') {
        eventData.content = msg.content;
        if (msg.files && msg.files.length > 0) eventData.files = msg.files;
        if (msg.clientId) eventData.clientId = msg.clientId; // v13.0 (F3.4)
      }

      sendSSE(res, msg.type, eventData, { id: msg.id });
    }
    lastMsgIndex = session.messages.length;
  }, 100);

  // Track this connection
  let connSet = sseConnections.get(sessionId);
  if (!connSet) {
    connSet = new Set();
    sseConnections.set(sessionId, connSet);
  }
  const conn = { res, keepAlive, checkInterval };
  connSet.add(conn);

  req.on('close', () => {
    clearInterval(checkInterval);
    clearInterval(keepAlive);
    connSet.delete(conn);
    if (connSet.size === 0) {
      sseConnections.delete(sessionId);
    }
  });
});

// POST /api/chat/ack — v10.13: Frontend acknowledges received events
router.post('/api/chat/ack', (req, res) => {
  const { sessionId, eventId, eventIds } = req.body;
  if (!sessionId) {
    return res.status(400).json({ ok: false, error: 'sessionId obrigatório' });
  }
  const session = getWebSession(sessionId);
  if (!session) {
    return res.status(404).json({ ok: false, error: 'Sessão não encontrada' });
  }

  // Update lastAckedEventId
  if (eventId) {
    session.lastAckedEventId = eventId;
  }
  if (Array.isArray(eventIds) && eventIds.length > 0) {
    session.lastAckedEventId = eventIds[eventIds.length - 1];
    // Remove acked events from ledger
    if (session.eventLedger) {
      const ackedSet = new Set(eventIds);
      session.eventLedger = session.eventLedger.filter(ev => !ackedSet.has(ev.id));
    }
  }

  // v10.16-fix: Persist ACK state to PostgreSQL so reconnects after restart don't replay old events
  dbRunWithRetry(
    `UPDATE luna_chat_sessions SET event_ledger = $1::jsonb, last_acked_event_id = $2, updated_at = NOW() WHERE id = $3`,
    [JSON.stringify(session.eventLedger || []), session.lastAckedEventId || null, sessionId]
  ).catch(e => console.error('[DB] Erro ao salvar ACK:', e.message));

  res.json({ ok: true, acked: eventId || (eventIds ? eventIds.length : 0), ledgerSize: session.eventLedger?.length || 0 });
});

// GET /api/chat/sessions — resposta imediata da memória/JSON; sync com PG em background.
router.get('/api/chat/sessions', async (req, res) => {
  // Primary source: in-memory map + JSON fallback (merged by id).
  let sessions = Array.from(webSessions.values());
  try {
    const jsonSessions = loadSessionsFromJson();
    const seen = new Set(sessions.map(s => s.id));
    for (const s of jsonSessions) {
      if (!seen.has(s.id)) {
        sessions.push(s);
        webSessions.set(s.id, s);
      }
    }
  } catch (e) {
    console.warn('[JSON] Erro ao carregar sessões para listagem:', e.message);
  }

  const responseSessions = sessions
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 100)
    .map(s => ({
      id: s.id,
      title: s.title,
      mode: s.mode || 'instant',
      provider: s.provider || 'kimi',
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: Array.isArray(s.messages) ? s.messages.length : 0,
    }));

  res.json({ ok: true, sessions: responseSessions });

  // Background: attempt to sync from PostgreSQL without blocking the response.
  (async () => {
    try {
      const rows = await db.query(
        `SELECT id, title, mode, persona, provider, messages, created_at, updated_at 
         FROM luna_chat_sessions ORDER BY updated_at DESC LIMIT 100`
      );
      for (const row of rows) {
        const session = {
          id: row.id,
          title: row.title,
          mode: row.mode,
          persona: row.persona || 'default',
          provider: row.provider || 'kimi',
          messages: Array.isArray(row.messages) ? row.messages : (typeof row.messages === 'string' ? JSON.parse(row.messages) : []),
          eventLedger: [],
          lastAckedEventId: null,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
        const existing = webSessions.get(session.id);
        if (!existing || new Date(session.updatedAt) > new Date(existing.updatedAt)) {
          webSessions.set(session.id, session);
        }
      }
      saveSessionsToJson(Array.from(webSessions.values()));
    } catch (e) {
      console.warn('[DB] Background sync de sessões falhou:', e.message);
    }
  })();
});

// GET /api/chat/session/:id/messages
router.get('/api/chat/session/:id/messages', async (req, res) => {
  let session = getWebSession(req.params.id);
  if (!session) {
    session = await loadSessionFromDB(req.params.id);
  }
  if (!session) return res.status(404).json({ ok: false, error: 'Sessão não encontrada' });
  res.json({ ok: true, messages: session.messages });
});

// POST /api/chat/session — create/rename/delete
router.post('/api/chat/session', async (req, res) => {
  const { action, sessionId, title, persona, provider } = req.body;

  switch (action) {
    case 'create': {
      const session = createWebSession(title || 'Nova conversa', 'instant', persona || 'default', sessionId || undefined, provider || 'kimi');
      res.json({ ok: true, session: { id: session.id, title: session.title, provider: session.provider } });
      break;
    }
    case 'rename': {
      if (!sessionId || !title) return res.status(400).json({ ok: false, error: 'sessionId e title obrigatórios' });
      let session = getWebSession(sessionId);
      if (!session) session = await loadSessionFromDB(sessionId);
      if (session && renameWebSession(sessionId, title)) {
        res.json({ ok: true });
      } else {
        res.status(404).json({ ok: false, error: 'Sessão não encontrada' });
      }
      break;
    }
    case 'setPersona': {
      if (!sessionId || !persona) return res.status(400).json({ ok: false, error: 'sessionId e persona obrigatórios' });
      let session = getWebSession(sessionId);
      if (!session) session = await loadSessionFromDB(sessionId);
      if (session) {
        session.persona = persona;
        session.updatedAt = new Date().toISOString();
        upsertSessionInJson(session);
        dbRunWithRetry(
          `UPDATE luna_chat_sessions SET persona = $1, updated_at = NOW() WHERE id = $2`,
          [persona, sessionId]
        ).catch(e => console.warn('[DB] Erro ao atualizar persona:', e.message));
        res.json({ ok: true, persona });
      } else {
        res.status(404).json({ ok: false, error: 'Sessão não encontrada' });
      }
      break;
    }
    case 'setProvider': {
      if (!sessionId || !provider) return res.status(400).json({ ok: false, error: 'sessionId e provider obrigatórios' });
      let session = getWebSession(sessionId);
      if (!session) session = await loadSessionFromDB(sessionId);
      if (session) {
        session.provider = provider;
        session.updatedAt = new Date().toISOString();
        upsertSessionInJson(session);
        dbRunWithRetry(
          `UPDATE luna_chat_sessions SET provider = $1, updated_at = NOW() WHERE id = $2`,
          [provider, sessionId]
        ).catch(e => console.warn('[DB] Erro ao atualizar provider:', e.message));
        res.json({ ok: true, provider });
      } else {
        res.status(404).json({ ok: false, error: 'Sessão não encontrada' });
      }
      break;
    }
    case 'delete': {
      if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId obrigatório' });
      if (deleteWebSession(sessionId)) {
        res.json({ ok: true });
      } else {
        res.status(404).json({ ok: false, error: 'Sessão não encontrada' });
      }
      break;
    }
    case 'resetAll': {
      // v10.32: Limpar todas as sessões web.
      webSessions.clear();
      saveSessionsToJson([]);
      activeStreams.clear();
      // Tentar limpar PostgreSQL sem bloquear a resposta.
      dbRunWithRetry('TRUNCATE TABLE luna_chat_sessions', [])
        .then(() => console.log('[DB] Tabela luna_chat_sessions truncada'))
        .catch(e => {
          console.warn('[DB] Não foi possível truncar luna_chat_sessions:', e.message);
          dbRunWithRetry('DELETE FROM luna_chat_sessions', [])
            .then(() => console.log('[DB] Registros de luna_chat_sessions removidos'))
            .catch(e2 => console.warn('[DB] Não foi possível deletar de luna_chat_sessions:', e2.message));
        });
      res.json({ ok: true, message: 'Todas as conversas foram resetadas' });
      break;
    }
    default:
      res.status(400).json({ ok: false, error: 'Ação inválida. Use: create, rename, setPersona, setProvider, delete, resetAll' });
  }
});

// POST /api/chat/cancel
router.post('/api/chat/cancel', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId obrigatório' });
  const stream = activeStreams.get(sessionId);
  if (stream) {
    stream.cancelled = true;
    activeStreams.delete(sessionId);
  }
  // v7.0: SOFT cancel when user clicks red button — agent keeps running in background.
  // Only frees the input. The agent continues sending events to frontend.
  try {
    const luna = await getLunaSoul();
    if (luna && luna.kimiBridge) {
      const userId = 'web-' + sessionId;
      await luna.kimiBridge.cancelStream(userId, true); // soft = true
    }
  } catch (e) {
    console.warn('[CANCEL] Kimi bridge cancel failed:', e.message);
  }
  res.json({ ok: true, message: 'Stream cancelado' });
});

// ============================================================
// Export API — JSON / Markdown / TXT (single or ZIP batch)
// ============================================================

function formatSessionAsJSON(session) {
  return JSON.stringify({
    id: session.id,
    title: session.title,
    mode: session.mode,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: session.messages || [],
  }, null, 2);
}

function formatSessionAsMarkdown(session) {
  let md = `# ${session.title || 'Sem título'}\n\n`;
  md += `- **ID:** ${session.id}\n`;
  md += `- **Modo:** ${session.mode || 'instant'}\n`;
  md += `- **Criado em:** ${session.createdAt || '-'}\n`;
  md += `- **Atualizado em:** ${session.updatedAt || '-'}\n\n`;
  md += `---\n\n`;
  const msgs = session.messages || [];
  for (const msg of msgs) {
    if (msg.type === 'text' || msg.type === 'response_delta') {
      const role = msg.role === 'user' ? '👤 Usuário' : '🤖 Luna';
      const time = msg.timestamp ? new Date(msg.timestamp).toLocaleString('pt-BR') : '';
      md += `### ${role}${time ? ` · ${time}` : ''}\n\n`;
      md += msg.content || '';
      md += '\n\n---\n\n';
    }
  }
  return md;
}

function formatSessionAsTXT(session) {
  let txt = `=== ${session.title || 'Sem titulo'} ===\n`;
  txt += `ID: ${session.id}\n`;
  txt += `Modo: ${session.mode || 'instant'}\n`;
  txt += `Criado: ${session.createdAt || '-'}\n`;
  txt += `Atualizado: ${session.updatedAt || '-'}\n`;
  txt += `========================\n\n`;
  const msgs = session.messages || [];
  for (const msg of msgs) {
    if (msg.type === 'text' || msg.type === 'response_delta') {
      const role = msg.role === 'user' ? '[Usuario]' : '[Luna]';
      txt += `${role} ${msg.content || ''}\n\n`;
    }
  }
  return txt;
}

router.post('/api/chat/export', async (req, res) => {
  const { sessionIds, format = 'json' } = req.body;
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
    return res.status(400).json({ ok: false, error: 'sessionIds deve ser um array não vazio' });
  }
  if (!['json', 'markdown', 'txt'].includes(format)) {
    return res.status(400).json({ ok: false, error: 'Formato inválido. Use json, markdown ou txt' });
  }

  try {
    // Load sessions from DB or memory cache
    const sessions = [];
    for (const id of sessionIds) {
      let session = webSessions.get(id);
      if (!session) {
        session = await loadSessionFromDB(id);
      }
      if (session) sessions.push(session);
    }

    if (sessions.length === 0) {
      return res.status(404).json({ ok: false, error: 'Nenhuma sessão encontrada' });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (sessions.length === 1) {
      // Single session — return file directly
      const session = sessions[0];
      let content, filename, mime;
      if (format === 'json') {
        content = formatSessionAsJSON(session);
        filename = `luna-chat-${session.id}-${timestamp}.json`;
        mime = 'application/json';
      } else if (format === 'markdown') {
        content = formatSessionAsMarkdown(session);
        filename = `luna-chat-${session.id}-${timestamp}.md`;
        mime = 'text/markdown';
      } else {
        content = formatSessionAsTXT(session);
        filename = `luna-chat-${session.id}-${timestamp}.txt`;
        mime = 'text/plain';
      }
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', mime);
      res.send(content);
    } else {
      // Multiple sessions — return ZIP
      const zip = new JSZip();
      for (const session of sessions) {
        let content, ext;
        if (format === 'json') {
          content = formatSessionAsJSON(session);
          ext = 'json';
        } else if (format === 'markdown') {
          content = formatSessionAsMarkdown(session);
          ext = 'md';
        } else {
          content = formatSessionAsTXT(session);
          ext = 'txt';
        }
        const safeTitle = (session.title || 'sem-titulo').replace(/[^a-zA-Z0-9\-_\s]/g, '').replace(/\s+/g, '-').slice(0, 40);
        zip.file(`${safeTitle}-${session.id.slice(-6)}.${ext}`, content);
      }
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      const filename = `luna-export-${timestamp}.zip`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/zip');
      res.send(zipBuffer);
    }
  } catch (e) {
    console.error('[EXPORT] Erro:', e.message);
    res.status(500).json({ ok: false, error: 'Erro ao exportar conversas' });
  }
});

// ============================================================
// Config API
// ============================================================

router.get('/api/config', (req, res) => {
  const env = readEnv();
  const promptResult = readSystemPrompt();
  res.json({
    ok: true,
    env,
    systemPrompt: promptResult.content,
    systemPromptFound: promptResult.found,
    paths: { env: ENV_PATH, soul: SOUL_PATH },
  });
});

router.post('/api/config', (req, res) => {
  const body = req.body;
  const results = [];
  if (body.env) {
    try { writeEnv(body.env); results.push('env'); }
    catch (e) { return res.status(500).json({ ok: false, error: `Erro ao salvar .env: ${e.message}` }); }
  }
  if (body.systemPrompt !== undefined) {
    try {
      if (writeSystemPrompt(body.systemPrompt)) results.push('systemPrompt');
      else return res.status(500).json({ ok: false, error: 'Não foi possível atualizar o system prompt' });
    } catch (e) { return res.status(500).json({ ok: false, error: `Erro ao salvar system prompt: ${e.message}` }); }
  }
  res.json({ ok: true, saved: results });
});

// ============================================================
// Test Routes
// ============================================================

async function testTelegram(token) {
  try {
    const https = require('https');
    return new Promise((resolve) => {
      const request = https.get(
        `https://api.telegram.org/bot${token}/getMe`,
        { timeout: 10000 },
        (r) => {
          let data = '';
          r.on('data', chunk => data += chunk);
          r.on('end', () => {
            try {
              const json = JSON.parse(data);
              resolve(json.ok ? { ok: true, bot: json.result } : { ok: false, error: json.description });
            } catch (e) { resolve({ ok: false, error: 'Resposta inválida da API' }); }
          });
        }
      );
      request.on('error', (e) => resolve({ ok: false, error: e.message }));
      request.on('timeout', () => { request.destroy(); resolve({ ok: false, error: 'Timeout' }); });
    });
  } catch (e) { return { ok: false, error: e.message }; }
}

function testNode() {
  try {
    const version = execFileSync('node', ['-v'], { encoding: 'utf-8', timeout: 5000 }).trim();
    const major = parseInt(version.replace('v', '').split('.')[0]);
    return { ok: true, version, sufficient: major >= 20, message: major >= 20 ? `Node.js ${version} ✅` : `Node.js ${version} — precisa v20+` };
  } catch (e) { return { ok: false, error: 'Node.js não encontrado no PATH' }; }
}

function testChrome() {
  const commands = ['google-chrome', 'chromium-browser', 'chromium', 'google-chrome-stable'];
  for (const cmd of commands) {
    try {
      const version = execFileSync(cmd, ['--version'], { encoding: 'utf-8', timeout: 5000 }).trim();
      return { ok: true, command: cmd, version };
    } catch (e) { /* try next */ }
  }
  return { ok: false, error: 'Chrome/Chromium não encontrado. Instale: sudo apt-get install google-chrome-stable' };
}

router.post('/api/test/telegram', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ ok: false, error: 'Token obrigatório' });
  const result = await testTelegram(token);
  res.status(result.ok ? 200 : 400).json(result);
});

router.get('/api/test/node', (req, res) => {
  res.json(testNode());
});

router.get('/api/test/chrome', (req, res) => {
  res.json(testChrome());
});

// ============================================================
// Plan Mode State
// ============================================================
const planModeSessions = new Map(); // sessionId -> { status, plan, planPath, createdAt }

// Wave 7: lazy TTL for plan sessions — entries older than 30min are dropped
// on access so approve/reject/revise answer 404 instead of acting on a stale plan.
const PLAN_SESSION_TTL_MS = 30 * 60 * 1000;
function getActivePlanSession(sessionId) {
  const meta = planModeSessions.get(sessionId);
  if (!meta) return null;
  if (meta.createdAt && Date.now() - meta.createdAt > PLAN_SESSION_TTL_MS) {
    planModeSessions.delete(sessionId);
    return null;
  }
  return meta;
}

// ============================================================
// Plan Mode Routes
// ============================================================

// POST /api/plan — start plan mode investigation
router.post('/api/plan', async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message) return res.status(400).json({ ok: false, error: 'message obrigatório' });

  let session = sessionId ? getWebSession(sessionId) : null;
  if (!session) {
    session = createWebSession('🔍 Plano: ' + message.slice(0, 30), 'thinking');
  }

  // Wave 7: refuse to start while a response stream is active in this session —
  // plan mode now shares the same Kimi chat (userId web-<id>), so starting
  // anyway would queue silently behind the active stream.
  if (activeStreams.has(session.id)) {
    console.log(`[PLAN MODE] Refusing to start: session ${session.id} already has an active stream`);
    return res.status(409).json({ ok: false, error: 'Já existe uma resposta em andamento nesta sessão. Aguarde terminar (ou cancele) antes de iniciar um plano.' });
  }

  // Wave 8: persist the user's plan request in the session (same shape as
  // POST /api/chat) — until now it only lived in the DOM and a reload lost it.
  addMessageToSession(session.id, {
    id: 'msg-' + Date.now(),
    role: 'user',
    type: 'text',
    content: message,
    files: [],
    timestamp: new Date().toISOString(),
  });

  // Mark session in plan mode
  planModeSessions.set(session.id, { status: 'investigating', plan: null, planPath: null, createdAt: Date.now() });

  res.json({ ok: true, sessionId: session.id, status: 'investigating' });

  // Process in background
  console.log(`[PLAN MODE] Starting plan mode for session ${session.id}, userId: web-${session.id}`);
  try {
    const luna = await getLunaSoul();
    console.log(`[PLAN MODE] Got LunaSoul, starting stream...`);
    const stream = luna.processPlanModeStream(message, {
      sessionId: session.id,
      userId: 'web-' + session.id,
    });

    let eventCount = 0;
    let planEventSeq = 0; // v10.13-fix: unique incremental IDs to prevent deduplication collisions
    for await (const ev of stream) {
      eventCount++;
      planEventSeq++;
      console.log(`[PLAN MODE] Event #${eventCount}: type=${ev.type}`);
      const planMeta = planModeSessions.get(session.id);
      if (!planMeta) break;

      if (ev.type === 'plan_start') {
        planMeta.status = 'investigating';
      } else if (ev.type === 'plan_delta') {
        planMeta.plan = ev.fullPlan || '';
      } else if (ev.type === 'plan_awaiting_approval') {
        planMeta.status = 'awaiting_approval';
        planMeta.plan = ev.plan || '';
        planMeta.planPath = ev.planPath || null;
      } else if (['thinking_delta', 'action_start', 'action_end', 'error', 'login_required'].includes(ev.type)) {
        // Forward to SSE via session messages
        addMessageToSession(session.id, {
          id: `plan-ev-${Date.now()}-${planEventSeq}`,
          role: 'assistant',
          type: ev.type,
          content: ev.text || ev.message || ev.error || '',
          fullThinking: ev.fullThinking || undefined,
          tool: ev.tool,
          params: ev.params,
          result: ev.result,
          timestamp: new Date().toISOString(),
        });
      }

      // Also emit via SSE by adding as a message
      if (['plan_start', 'plan_delta', 'plan_display', 'plan_awaiting_approval'].includes(ev.type)) {
        addMessageToSession(session.id, {
          id: `plan-${Date.now()}-${planEventSeq}`,
          role: 'assistant',
          type: ev.type,
          content: ev.plan || ev.message || '',
          plan: ev.plan || undefined,
          planPath: ev.planPath || undefined,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Wave 7: stream ended without reaching awaiting_approval (cancel, bridge
    // failure or turn exhaustion) — mark the entry as 'error' so approve/reject
    // answer coherently instead of acting on a dead plan.
    const planMetaEnd = planModeSessions.get(session.id);
    if (planMetaEnd && planMetaEnd.status === 'investigating') {
      planMetaEnd.status = 'error';
      planMetaEnd.error = 'Stream do plano encerrado antes de produzir um plano (cancelado ou erro).';
      // Wave 7 review: notify the frontend so planModeState leaves 'processing' —
      // without this event the next user message hit the duplicate guard and was
      // silently dropped (the soul's cancel 'system' event is not forwarded).
      addMessageToSession(session.id, {
        id: 'plan-err-' + Date.now(),
        role: 'assistant',
        type: 'plan_error',
        content: 'A investigação do plano foi cancelada ou encerrada antes de produzir um plano. Inicie um novo plano quando quiser.',
        timestamp: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.error('[PLAN MODE] Error:', e.message, e.stack);
    const prev = planModeSessions.get(session.id) || {};
    planModeSessions.set(session.id, { ...prev, status: 'error', error: e.message });
    addMessageToSession(session.id, {
      id: 'plan-err-' + Date.now(),
      role: 'assistant',
      type: 'error',
      content: e.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// POST /api/plan/approve — approve plan and switch to execution
router.post('/api/plan/approve', (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId obrigatório' });

  const planMeta = getActivePlanSession(sessionId);
  if (!planMeta) return res.status(404).json({ ok: false, error: 'Nenhum plano ativo para esta sessão' });
  if (planMeta.status === 'error') {
    return res.status(409).json({ ok: false, error: 'A investigação do plano falhou ou foi cancelada. Gere o plano novamente.' });
  }
  // Wave 8: approve is only valid from awaiting_approval — a duplicate approve
  // (or an approve against an investigating/already-decided plan) is refused.
  if (planMeta.status !== 'awaiting_approval') {
    return res.status(409).json({ ok: false, error: `Este plano não está aguardando aprovação (status atual: ${planMeta.status}).` });
  }

  planMeta.status = 'approved';

  const session = getWebSession(sessionId);
  if (session) {
    session.planMode = false;
    session.planStatus = 'approved';
  }

  // Notify via SSE
  addMessageToSession(sessionId, {
    id: 'plan-approved-' + Date.now(),
    role: 'assistant',
    type: 'plan_approved',
    content: '✅ Plano aprovado! Pode continuar com mensagens normais.',
    timestamp: new Date().toISOString(),
  });

  res.json({ ok: true, status: 'approved' });
});

// POST /api/plan/reject — reject plan
router.post('/api/plan/reject', (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId obrigatório' });

  const planMeta = getActivePlanSession(sessionId);
  if (!planMeta) return res.status(404).json({ ok: false, error: 'Nenhum plano ativo para esta sessão' });
  if (planMeta.status === 'error') {
    return res.status(409).json({ ok: false, error: 'A investigação do plano falhou ou foi cancelada. Gere o plano novamente.' });
  }

  planMeta.status = 'rejected';

  const session = getWebSession(sessionId);
  if (session) {
    session.planMode = false;
    session.planStatus = 'rejected';
  }

  addMessageToSession(sessionId, {
    id: 'plan-rejected-' + Date.now(),
    role: 'assistant',
    type: 'plan_rejected',
    content: '❌ Plano rejeitado. Pode solicitar um novo plano com /plan.',
    timestamp: new Date().toISOString(),
  });

  res.json({ ok: true, status: 'rejected' });
});

// POST /api/plan/revise — revise plan
router.post('/api/plan/revise', (req, res) => {
  const { sessionId, revisedPlan } = req.body;
  if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId obrigatório' });

  const planMeta = getActivePlanSession(sessionId);
  if (!planMeta) return res.status(404).json({ ok: false, error: 'Nenhum plano ativo para esta sessão' });
  if (planMeta.status === 'error') {
    return res.status(409).json({ ok: false, error: 'A investigação do plano falhou ou foi cancelada. Gere o plano novamente.' });
  }

  planMeta.plan = revisedPlan || planMeta.plan;
  planMeta.status = 'awaiting_approval';

  addMessageToSession(sessionId, {
    id: 'plan-revised-' + Date.now(),
    role: 'assistant',
    type: 'plan_revised',
    content: '✏️ Plano revisado. Aguardando aprovação.',
    plan: planMeta.plan,
    timestamp: new Date().toISOString(),
  });

  res.json({ ok: true, status: 'awaiting_approval' });
});

// ============================================================
// Local System Commands (/api/system/*)
// ============================================================

const LUNA_NEXO_SCRIPT = path.join(config.NEXO_DIR || path.resolve(__dirname, '..'), 'luna-nexo.sh');
const ALLOWED_SCRIPT_ACTIONS = new Set(['start', 'stop', 'restart']);

function isPortListening(port) {
  return new Promise((resolve) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) return resolve(false);
    const server = require('net').createServer();
    server.once('error', (err) => {
      resolve(err.code === 'EADDRINUSE');
    });
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port, '127.0.0.1');
  });
}

async function pgrepFirstPidSafe(pattern) {
  if (typeof pattern !== 'string' || !/^[a-zA-Z0-9_.\-\/]+$/.test(pattern)) return null;
  return new Promise((resolve) => {
    let stdout = '';
    const child = require('child_process').spawn('pgrep', ['-f', pattern], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.on('data', d => stdout += d.toString());
    child.on('close', (code) => {
      if (code !== 0) return resolve(null);
      const pids = stdout.trim().split('\n').filter(Boolean);
      const pid = pids.length > 0 ? parseInt(pids[0], 10) : null;
      resolve(Number.isFinite(pid) && pid > 0 ? pid : null);
    });
    child.on('error', () => resolve(null));
  });
}

async function processUptime(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return '?';
  return new Promise((resolve) => {
    let stdout = '';
    const child = require('child_process').spawn('ps', ['-p', String(pid), '-o', 'etime='], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.on('data', d => stdout += d.toString());
    child.on('close', (code) => resolve(code === 0 ? stdout.trim() : '?'));
    child.on('error', () => resolve('?'));
  });
}

function runScript(action, timeoutMs = 30000) {
  if (!ALLOWED_SCRIPT_ACTIONS.has(action)) {
    console.warn(`[LunaSystem] Ação não permitida: ${action}`);
    return Promise.resolve({ ok: false, error: 'Ação não permitida' });
  }
  if (!fs.existsSync(LUNA_NEXO_SCRIPT)) {
    return Promise.resolve({ ok: false, error: `Script não encontrado: ${LUNA_NEXO_SCRIPT}` });
  }
  console.warn(`[LunaSystem] Executando script: bash ${LUNA_NEXO_SCRIPT} ${action}`);
  return new Promise((resolve) => {
    const child = require('child_process').spawn('bash', [LUNA_NEXO_SCRIPT, action], { timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: 'Timeout — comando demorou demais' });
    }, timeoutMs);
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output: (stdout || stderr || '').trim(), error: code === 0 ? null : stderr || 'exit code ' + code });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
  });
}

async function getServiceStatus() {
  const results = {};
  const services = [
    { name: 'nexo-dashboard', port: 3456, label: 'Dashboard NEXO PRO' },
    { name: 'luna-web-server', port: 3458, label: 'Luna Web Server' },
    { name: 'luna-web-vite', port: 5173, label: 'Luna Web Vite' },
  ];
  for (const svc of services) {
    const listening = await isPortListening(svc.port);
    results[svc.name] = { status: listening ? 'running' : 'stopped', port: svc.port, label: svc.label };
  }
  // Telegram bot
  try {
    const tgPid = await pgrepFirstPidSafe('telegram-luna-adapter.cjs');
    if (tgPid) {
      const uptime = await processUptime(tgPid);
      results['telegram-bot'] = { status: 'running', pid: tgPid, uptime, label: 'Bot do Telegram' };
    } else {
      results['telegram-bot'] = { status: 'stopped', label: 'Bot do Telegram' };
    }
  } catch (e) {
    results['telegram-bot'] = { status: 'stopped', label: 'Bot do Telegram' };
  }
  // Kimi Bridge status via Luna Soul
  try {
    if (lunaSoul && lunaSoul.kimiBridge) {
      const kb = lunaSoul.kimiBridge;
      results['kimi-bridge'] = {
        status: kb.browser ? 'connected' : 'disconnected',
        label: 'Kimi Bridge',
        pages: kb.userSessions?.size || 0,
        contexts: kb.userContexts?.size || 0,
        semaphore: kb.semaphore?.current || 0,
        maxPages: kb.maxPages || 999,
      };
    } else {
      results['kimi-bridge'] = { status: 'disconnected', label: 'Kimi Bridge' };
    }
  } catch (e) {
    results['kimi-bridge'] = { status: 'disconnected', label: 'Kimi Bridge' };
  }
  // Luna Soul status
  try {
    results['luna-soul'] = {
      status: lunaReady && lunaSoul ? 'ready' : 'not-ready',
      label: 'Luna Soul',
      ready: lunaReady,
      hasSessionManager: lunaSoul?.sessionManager !== undefined,
    };
  } catch (e) {
    results['luna-soul'] = { status: 'not-ready', label: 'Luna Soul' };
  }
  return results;
}

router.post('/api/system/restart', async (req, res) => {
  if (fs.existsSync(LUNA_NEXO_SCRIPT)) {
    res.json({ ok: true, message: '🔄 Reiniciando todos os serviços...' });
    setTimeout(() => runScript('restart'), 500);
    return;
  }
  // Fallback: the legacy control script is absent on this machine — restart
  // the core services via pm2 with canonical monorepo names.
  const all = selfheal.resolveServiceNames(['luna-server', 'nexo-dashboard', 'luna-vite', 'telegram-bot']);
  res.json({ ok: true, message: '🔄 Reiniciando todos os serviços via pm2...' });
  selfheal.restartServices(all);
});

router.post('/api/system/stop', async (req, res) => {
  if (fs.existsSync(LUNA_NEXO_SCRIPT)) {
    res.json({ ok: true, message: '🛑 Parando todos os serviços...' });
    setTimeout(() => runScript('stop'), 500);
    return;
  }
  const all = selfheal.resolveServiceNames(['nexo-dashboard', 'luna-vite', 'telegram-bot']);
  res.json({ ok: true, message: '🛑 Parando serviços (luna-server permanece para poder religá-los)...' });
  selfheal.stopServices(all);
});

router.post('/api/system/start', async (req, res) => {
  if (fs.existsSync(LUNA_NEXO_SCRIPT)) {
    const result = await runScript('start', 60000);
    res.json({ ok: result.ok, message: result.ok ? '▶ Serviços iniciados' : result.error, output: result.output });
    return;
  }
  const all = selfheal.resolveServiceNames(['nexo-dashboard', 'luna-vite', 'telegram-bot']);
  res.json({ ok: true, message: '▶ Serviços iniciados via pm2', output: all.join(', ') });
  selfheal.restartServices(all);
});

// Targeted self-heal: restart ONLY the services the caller diagnosed as
// broken (bridge/soul live inside luna-server). Allowlisted, deduped, and
// never invoked with --update-env (Wave 6 incident).
router.post('/api/system/selfheal', async (req, res) => {
  const pm2Names = selfheal.resolveServiceNames(req.body?.services);
  if (pm2Names.length === 0) {
    return res.status(400).json({
      ok: false,
      error: 'Nenhum serviço válido informado',
      valid: Object.keys(selfheal.PM2_SERVICES),
    });
  }
  res.json({ ok: true, message: `🛠️ Reiniciando: ${pm2Names.join(', ')}`, services: pm2Names });
  selfheal.restartServices(pm2Names);
});

router.get('/api/system/status', async (req, res) => {
  const status = await getServiceStatus();
  res.json({ ok: true, status });
});

router.get('/api/system/health', async (req, res) => {
  const status = await getServiceStatus();
  const allRunning = Object.values(status).every(s => s.status === 'running' || s.status === 'connected');
  res.json({
    ok: allRunning,
    status,
    timestamp: new Date().toISOString(),
    lunaSoulReady: lunaReady,
  });
});

// v10.2: Agent status — simplified for frontend polling
router.get('/api/system/agent', async (req, res) => {
  const status = await getServiceStatus();
  const soul = status['luna-soul'];
  const bridge = status['kimi-bridge'];
  const server = status['luna-web-server'];
  res.json({
    ok: true,
    agent: {
      state: soul?.status === 'ready' && bridge?.status === 'connected' ? 'online' :
             soul?.status === 'ready' ? 'degraded' :
             server?.status === 'running' ? 'starting' : 'offline',
      lunaSoul: soul?.status || 'unknown',
      bridge: bridge?.status || 'unknown',
      server: server?.status || 'unknown',
      pages: bridge?.pages || 0,
      timestamp: new Date().toISOString(),
    },
  });
});

// v10.2: Visible mode control — make all shell commands open in terminal
router.post('/api/system/visible', async (req, res) => {
  try {
    const lunaTools = require(path.join(LUNA_KERNEL_DIR, 'luna-tools.cjs'));
    if (lunaTools.setVisibleMode) {
      lunaTools.setVisibleMode(true);
      res.json({ ok: true, mode: 'visible', message: '🖥️ Modo visível ATIVADO — todos os comandos abrirão em terminal' });
    } else {
      res.status(500).json({ ok: false, error: 'setVisibleMode não disponível' });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/system/invisible', async (req, res) => {
  try {
    const lunaTools = require(path.join(LUNA_KERNEL_DIR, 'luna-tools.cjs'));
    if (lunaTools.setVisibleMode) {
      lunaTools.setVisibleMode(false);
      res.json({ ok: true, mode: 'invisible', message: '👻 Modo invisível ATIVADO — comandos rodarão em background' });
    } else {
      res.status(500).json({ ok: false, error: 'setVisibleMode não disponível' });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/api/system/logs', async (req, res) => {
  const lines = parseInt(req.query.lines) || 50;
  if (!Number.isInteger(lines) || lines < 1 || lines > 1000) {
    return res.status(400).json({ ok: false, error: 'lines deve estar entre 1 e 1000' });
  }
  console.warn(`[LunaSystem] Executando journalctl --user -u luna-server -n ${lines}`);
  const result = await new Promise((resolve) => {
    const child = require('child_process').spawn('journalctl', ['--user', '-u', 'luna-server', '-n', String(lines), '--no-pager'], { timeout: 10000 });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ output: 'Timeout ao ler logs' });
    }, 10000);
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('close', (code) => {
      clearTimeout(timer);
      const output = stdout.trim() || stderr.trim() || 'Nenhum log disponível';
      resolve({ output: code === 0 ? output : (output + '\n(journalctl pode não estar disponível)') });
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ output: 'Logs não disponíveis via journalctl' });
    });
  });
  res.json({ ok: true, logs: result.output });
});

// POST /api/system/test-connection — test Telegram, Dashboard, or Kimi
router.post('/api/system/test-connection', async (req, res) => {
  const { type } = req.body;
  if (!type) return res.status(400).json({ ok: false, error: 'type obrigatório (telegram, dashboard, kimi)' });

  if (type === 'telegram') {
    const token = req.body.token;
    if (!token) return res.status(400).json({ ok: false, error: 'token obrigatório' });
    try {
      const https = require('https');
      const result = await new Promise((resolve, reject) => {
        const req = https.get(`https://api.telegram.org/bot${token}/getMe`, (resp) => {
          let data = '';
          resp.on('data', chunk => data += chunk);
          resp.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (json.ok) resolve({ ok: true, bot: json.result });
              else resolve({ ok: false, error: json.description || 'Token inválido' });
            } catch { resolve({ ok: false, error: 'Resposta inválida da API do Telegram' }); }
          });
        });
        req.on('error', (e) => resolve({ ok: false, error: e.message }));
        req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
      });
      res.json(result);
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  } else if (type === 'dashboard') {
    const token = req.body.token;
    if (!token) return res.status(400).json({ ok: false, error: 'token obrigatório' });
    try {
      jwt.verify(token, resolveJwtSecret());
      res.json({ ok: true, message: 'Token válido' });
    } catch (e) {
      res.json({ ok: false, error: 'Token inválido: ' + e.message });
    }
  } else if (type === 'kimi') {
    try {
      if (lunaSoul && lunaSoul.kimiBridge && lunaSoul.kimiBridge.browser) {
        res.json({ ok: true, message: 'Kimi Bridge conectado ao Chrome', pages: lunaSoul.kimiBridge.userSessions?.size || 0 });
      } else {
        res.json({ ok: false, error: 'Kimi Bridge não conectado' });
      }
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  } else {
    res.status(400).json({ ok: false, error: 'Tipo desconhecido. Use: telegram, dashboard, kimi' });
  }
});

// POST /api/luna/execute — execute a Luna tool directly (no Kimi Bridge)
router.post('/api/luna/execute', async (req, res) => {
  const { tool, params } = req.body;
  if (!tool) return res.status(400).json({ ok: false, error: 'tool obrigatorio' });

  try {
    const lunaTools = require(path.join(LUNA_DIR, 'luna-tools.cjs'));
    const fn = lunaTools[tool];
    if (!fn || typeof fn !== 'function') {
      return res.status(400).json({ ok: false, error: `Tool desconhecida: ${tool}` });
    }
    const result = await fn(params);
    res.json({ ok: true, result });
  } catch (e) {
    console.error(`[LUNA TOOL] ${tool} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/luna/confirm — resolve a pending destructive-operation confirmation
router.post('/api/luna/confirm', async (req, res) => {
  const { sessionId, confirmationId, action } = req.body;
  console.log('[LUNA CONFIRM] request:', { sessionId, confirmationId, action });
  if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId obrigatorio' });
  if (!confirmationId) return res.status(400).json({ ok: false, error: 'confirmationId obrigatorio' });

  try {
    const luna = await getLunaSoul();
    if (!luna || typeof luna.confirmAction !== 'function') {
      return res.status(501).json({ ok: false, error: 'LunaSoul não suporta confirmação' });
    }
    const result = luna.confirmAction(sessionId, confirmationId, action);
    console.log('[LUNA CONFIRM] result:', result);
    // v12.2-fix: a failed resolution must NOT return HTTP 200 — the frontend
    // used to swallow {ok:false} and the Confirm/Cancel button looked dead.
    // 410 Gone = the pending confirmation no longer exists (e.g. server
    // restarted and the in-memory map was wiped).
    if (result && result.ok === false) {
      return res.status(410).json(result);
    }
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[LUNA CONFIRM] error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/selfhost/download — generate self-host package
router.post('/api/selfhost/download', async (req, res) => {
  try {
    const tmpDir = `/tmp/luna-selfhost-${Date.now()}`;
    fs.mkdirSync(tmpDir, { recursive: true });

    // Copy install.sh
    const installSrc = path.join(LUNA_DIR, 'install.sh');
    if (fs.existsSync(installSrc)) {
      fs.copyFileSync(installSrc, path.join(tmpDir, 'install.sh'));
    }

    // Generate pre-configured .env
    const env = readEnv();
    const envContent = `# Luna Kernel v5.0 — Self-Host Package
# Generated by Luna Config Panel
# NEXO DIGITAL S.L.
# ============================================================

# ── REQUIRED ──

TELEGRAM_BOT_TOKEN=${env.TELEGRAM_BOT_TOKEN || 'your_telegram_bot_token_here'}
INTERNAL_API_TOKEN=${env.INTERNAL_API_TOKEN || 'your_dashboard_api_token_here'}
JWT_SECRET=${env.JWT_SECRET || 'REQUIRED_DEFINE_JWT_SECRET'}

# ── OPTIONAL ──

KIMI_TIMEOUT=${env.KIMI_TIMEOUT || '120000'}
KIMI_MAX_PAGES=${env.KIMI_MAX_PAGES || '5'}
KIMI_IDLE_TIMEOUT=${env.KIMI_IDLE_TIMEOUT || '600000'}
KIMI_COOLDOWN_MS=${env.KIMI_COOLDOWN_MS || '5000'}
KIMI_MAX_TYPE_LENGTH=${env.KIMI_MAX_TYPE_LENGTH || '500'}
KIMI_LOG_MAX_MB=${env.KIMI_LOG_MAX_MB || '10'}
LUNA_COMPACT_THRESHOLD=${env.LUNA_COMPACT_THRESHOLD || '24'}
LUNA_COMPACT_TOKEN_THRESHOLD=${env.LUNA_COMPACT_TOKEN_THRESHOLD || '120000'}
# LUNA_CHROME_PATH=/usr/bin/google-chrome
LUNA_DEBUG=${env.LUNA_DEBUG || 'false'}
LUNA_CONFIG_PORT=3458
`;
    fs.writeFileSync(path.join(tmpDir, '.env'), envContent, 'utf-8');

    // Generate README
    const readme = `# 🌙 Luna Kernel v5.0 — Self-Host Package

## Pré-requisitos
- Node.js v20+
- Git
- Google Chrome ou Chromium

## Instalação Rápida
\`\`\`bash
cd luna-selfhost
bash install.sh
\`\`\`

## Iniciar
\`\`\`bash
cd ${LUNA_KERNEL_DIR}
node luna-server.js
# ou
node telegram-luna-adapter.cjs
\`\`\`

## Acessar
- Web: http://localhost:3458
- Telegram: envie mensagem para o bot configurado

## Configurações
O arquivo \`.env\` já vem pré-configurado com seus tokens.
Para editar, use o painel web em Configurações.

---
NEXO DIGITAL S.L. — Private Use Only
`;
    fs.writeFileSync(path.join(tmpDir, 'README.md'), readme, 'utf-8');

    // Generate start.sh
    const startSh = `#!/bin/bash
cd "\$(dirname "\$0")"
echo "🌙 Iniciando Luna Kernel..."
cd ${LUNA_KERNEL_DIR} 2>/dev/null || { bash install.sh; cd ${LUNA_KERNEL_DIR}; }
npm install
node luna-server.js
`;
    fs.writeFileSync(path.join(tmpDir, 'start.sh'), startSh, 'utf-8');

    // Create zip
    const zipPath = `${tmpDir}.zip`;
    console.warn(`[SelfHost] Executando zip -r ${zipPath} .`);
    await new Promise((resolve, reject) => {
      const child = require('child_process').spawn('zip', ['-r', zipPath, '.'], { cwd: tmpDir, timeout: 30000 });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Timeout ao criar zip'));
      }, 30000);
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`zip falhou com código ${code}`));
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    res.download(zipPath, 'luna-selfhost.zip', (err) => {
      // Cleanup temp files after sending
      setTimeout(() => {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore cleanup errors */ }
        try { fs.unlinkSync(zipPath); } catch (e) { /* ignore cleanup errors */ }
      }, 30000);
      if (err) console.error('Download error:', err.message);
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Erro ao gerar pacote: ' + e.message });
  }
});

// ============================================================
// Auth Routes (new)
// ============================================================
// NOTE: validateCredentials, generateToken, requireAuth are injected
// from server.js via router.locals or passed as options.
// For now, we export a function that accepts these dependencies.

function setupAuth({ validateCredentials, generateToken, requireAuth }) {
  router.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'Username e senha obrigatórios' });
    }
    const user = await validateCredentials(username, password);
    if (!user) {
      return res.status(401).json({ ok: false, error: 'Credenciais inválidas' });
    }
    const token = generateToken(user.id);
    res.json({ ok: true, token, user });
  });

  router.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ ok: true, user: req.user });
  });
}

// GET /api/personas — list available personas
router.get('/api/personas', (req, res) => {
  try {
    const fs = require('fs');
    const personasDir = config.PATHS.personas;
    const personas = [];
    if (fs.existsSync(personasDir)) {
      const files = fs.readdirSync(personasDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(personasDir, file), 'utf8');
        const nameMatch = content.match(/name:\s*(.+)/);
        const descMatch = content.match(/description:\s*(.+)/);
        personas.push({
          id: file.replace('.md', ''),
          name: nameMatch ? nameMatch[1].trim() : file.replace('.md', ''),
          description: descMatch ? descMatch[1].trim() : '',
        });
      }
    }
    res.json({ ok: true, personas });
  } catch (e) {
    console.error('[PERSONAS] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/providers — list available providers from luna-kernel provider-configs
router.get('/api/providers', (req, res) => {
  try {
    const names = providerLoader.listProviders();
    const providers = names.map(name => {
      try {
        const cfg = providerLoader.loadProviderConfig(name);
        return { name, displayName: cfg.displayName || name, baseUrl: cfg.baseUrl || '' };
      } catch (e) {
        return { name, displayName: name, baseUrl: '' };
      }
    });
    res.json({ ok: true, providers });
  } catch (e) {
    console.error('[PROVIDERS] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message, providers: [] });
  }
});

// ============================================================
// System Routes — heartbeat, turnoff, health
// ============================================================

// POST /api/system/heartbeat — keep the agent page alive
router.post('/api/system/heartbeat', async (req, res) => {
  const { userId } = req.body;
  try {
    const luna = await getLunaSoul();
    if (luna.kimiBridge) {
      const uid = userId || 'web-default';
      luna.kimiBridge.setPersistent(uid);
      // Update lastActivity to prevent idle cleanup
      const session = luna.kimiBridge.userSessions.get(uid);
      if (session) {
        session.lastActivity = Date.now();
      }
    }
    res.json({ ok: true, persistent: true });
  } catch (e) {
    console.error('[HEARTBEAT] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/system/turnoff — explicitly close the agent page
router.post('/api/system/turnoff', async (req, res) => {
  const { userId } = req.body;
  try {
    const luna = await getLunaSoul();
    if (luna.kimiBridge) {
      const uid = userId || 'web-default';
      luna.kimiBridge.unsetPersistent(uid);
      const session = luna.kimiBridge.userSessions.get(uid);
      if (session && session.page && !session.page.isClosed()) {
        await session.page.close().catch(() => {});
      }
      luna.kimiBridge.userSessions.delete(uid);
      const ctx = luna.kimiBridge.userContexts.get(uid);
      if (ctx && typeof ctx.close === 'function') {
        await ctx.close().catch(() => {});
        luna.kimiBridge.userContexts.delete(uid);
      }
    }
    res.json({ ok: true, message: 'Luna desligada. Envie uma mensagem para acordar.' });
  } catch (e) {
    console.error('[TURNOFF] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /api/luna/compact — Manual context compaction ──
// v10.40: Now uses the SAME code path as the automatic context_limit flow.
// It compacts, opens a fresh Kimi thread, and CONTINUES the conversation by
// resending the last user message — no stale chat behind the scenes.
router.post('/api/luna/compact', async (req, res) => {
  try {
    const { sessionId, userId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ ok: false, error: 'sessionId obrigatório' });
    }

    const luna = await getLunaSoul();
    if (!luna) {
      return res.status(503).json({ ok: false, error: 'Luna Soul não disponível' });
    }

    // SSE setup
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const uid = userId || 'web-default';
    const stream = luna.compactAndContinue(sessionId, uid);

    for await (const ev of stream) {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }

    res.end();
  } catch (e) {
    console.error('[LunaCompact] Erro:', e.message);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ ok: false, error: e.message });
    }
  }
});

module.exports = { router, setupAuth, getLunaSoul, getWebSession, addMessageToSession };

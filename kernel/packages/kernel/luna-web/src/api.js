import { connectionStatus, isStreaming, user } from './stores.js';
import { shouldForceLogout } from './lib/authGuard.js';

// ============================================================
// Auth Helpers
// ============================================================

function getToken() {
  return localStorage.getItem('luna_token');
}

function authHeaders(contentType = true) {
  const h = {};
  const token = getToken();
  if (token) h['Authorization'] = `Bearer ${token}`;
  if (contentType) h['Content-Type'] = 'application/json';
  return h;
}

export class SSEManager {
  constructor() {
    this.eventSource = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 20; // v10.24-fix: Avoid infinite reconnect loops
    this.baseDelay = 1000;
    this.maxDelay = 30000;
    this.isIntentionallyClosed = false;
    this.gracefulClose = false;
    this.statusDebounceTimer = null;
    this.lastStatus = null;
    this.currentSessionId = null;
    this.onEventCallback = null;
    this.fallbackTimer = null;
    this.reconnectTimer = null;
    this.lastMessageCount = 0;
  }

  _setStatus(status) {
    if (this.statusDebounceTimer) clearTimeout(this.statusDebounceTimer);
    if (status === 'disconnected' && this.lastStatus === 'connected') {
      this.statusDebounceTimer = setTimeout(() => {
        connectionStatus.set(status);
        this.lastStatus = status;
      }, 400);
    } else {
      connectionStatus.set(status);
      this.lastStatus = status;
    }
  }

  // v5.2: Fallback polling when SSE is down
  _startFallbackPolling(sessionId) {
    if (this.fallbackTimer) clearInterval(this.fallbackTimer);
    // v5.5-fix: On first activation, record current history length so we don't
    // replay the ENTIRE history. lastMessageCount starts at 0, so slice(0) emits all.
    const initialCount = this.lastMessageCount;
    this.fallbackTimer = setInterval(async () => {
      if (this.isIntentionallyClosed || this.gracefulClose || this.eventSource) return;
      try {
        const res = await fetch(`/api/chat/session/${encodeURIComponent(sessionId)}/messages`, {
          headers: authHeaders(false)
        });
        const data = await res.json();
        if (data.ok && data.messages) {
          // v5.5-fix: First activation — skip existing history, only track new messages
          if (this.lastMessageCount === 0 && initialCount === 0) {
            this.lastMessageCount = data.messages.length;
            return;
          }
          const newMessages = data.messages.slice(this.lastMessageCount);
          for (const msg of newMessages) {
            if (this.onEventCallback) {
              this.onEventCallback({
                type: msg.type || 'response_delta',
                role: msg.role,
                text: msg.content,
                fullResponse: msg.content,
                source: 'fallback',
                timestamp: msg.timestamp,
              });
            }
          }
          this.lastMessageCount = data.messages.length;
        }
      } catch (e) {
        // Silently fail — fallback is best-effort
      }
    }, 2000);
  }

  _stopFallbackPolling() {
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  connect(sessionId, onEvent) {
    this.onEventCallback = onEvent;
    // v4.1-fix: Prevent duplicate connections for same session
    if (this.eventSource && this.currentSessionId === sessionId) {
      console.log(`[SSE] Already connected to session ${sessionId}, skipping`);
      return;
    }
    // Wave 4 bug 3: never let an older backoff timer fire into a new connection
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    // Disconnect any existing connection before creating new one
    if (this.eventSource) {
      console.log('[SSE] Disconnecting existing connection before reconnect');
      this.disconnect();
    }
    // Wave 4 bug 5: a new session must not slice its history with the previous
    // session's message count (fallback polling starts clean).
    if (this.currentSessionId !== sessionId) {
      this.lastMessageCount = 0;
    }
    this.currentSessionId = sessionId;
    this.isIntentionallyClosed = false;
    this.gracefulClose = false;
    this.reconnectAttempts = 0;
    this._stopFallbackPolling();

    const token = getToken();
    const url = `/api/chat/stream?sessionId=${encodeURIComponent(sessionId)}${token ? '&token=' + encodeURIComponent(token) : ''}`;
    this.eventSource = new EventSource(url);

    this.eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        onEvent(event);
        this.reconnectAttempts = 0;
        this._setStatus('connected');
        if (event.type === 'done' || event.type === 'error') {
          this.gracefulClose = true;
        }
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    this.eventSource.onopen = () => {
      this.reconnectAttempts = 0;
      this._setStatus('connected');
    };

    this.eventSource.onerror = () => {
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
      if (!this.isIntentionallyClosed && !this.gracefulClose) {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          this._setStatus('disconnected');
          console.log('[SSE] Max reconnect attempts reached. Giving up.');
          this._stopFallbackPolling();
          // Notify caller so UI can show reconnect button
          if (onEvent) {
            onEvent({ type: 'error', error: 'Conexão com o servidor perdida. Recarregue a página ou tente uma nova mensagem.', source: 'sse' });
          }
          return;
        }
        this._setStatus('reconnecting');
        // v5.2: Start fallback polling immediately
        this._startFallbackPolling(sessionId);
        const delay = Math.min(this.baseDelay * Math.pow(2, this.reconnectAttempts) + Math.random() * 1000, this.maxDelay);
        this.reconnectAttempts++;
        console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          // Wave 4 bug 3: disconnect() may have run while this timer was pending —
          // never resurrect an intentionally closed connection.
          if (this.isIntentionallyClosed || this.gracefulClose) return;
          this.connect(sessionId, onEvent);
        }, delay);
      } else if (this.gracefulClose) {
        this._setStatus('disconnected');
        console.log('[SSE] Graceful close — no reconnect needed.');
        this._stopFallbackPolling();
      }
    };
  }

  disconnect() {
    this.isIntentionallyClosed = true;
    this.gracefulClose = true;
    this.currentSessionId = null;
    this.onEventCallback = null;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this._stopFallbackPolling();
    if (this.statusDebounceTimer) clearTimeout(this.statusDebounceTimer);
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this._setStatus('disconnected');
  }
}

export async function sendMessage(message, sessionId, mode = 'instant', files = [], messageId = null, provider = 'kimi') {
  let filePayload = [];
  if (files && files.length > 0) {
    filePayload = await Promise.all(
      files.map(async (file) => {
        const dataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });
        return {
          name: file.name,
          type: file.type,
          size: file.size,
          data: dataUrl,
        };
      })
    );
  }
  const body = { message, sessionId, mode, provider, files: filePayload };
  if (messageId) body.messageId = messageId;

  // v9.2-fix: Retry with exponential backoff — prevents "Unexpected end of JSON input"
  // when the backend service crashes or restarts mid-request.
  const maxRetries = 3;
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      return await res.json();
    } catch (e) {
      lastError = e;
      if (attempt < maxRetries - 1) {
        const delay = 1000 * Math.pow(2, attempt) + Math.random() * 500;
        console.log(`[sendMessage] Retry ${attempt + 1}/${maxRetries - 1} in ${Math.round(delay)}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

export async function cancelStream(sessionId) {
  isStreaming.set(false);
  await fetch('/api/chat/cancel', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ sessionId })
  });
}

// Wave 4 bug 4: acknowledge delivered SSE events so the backend event ledger
// (cap 200) is pruned instead of replaying every event on each reconnect.
// Best-effort: failures are swallowed — the ledger cap + frontend dedup is
// the safety net.
export async function ackEvents(sessionId, eventIds) {
  if (!sessionId || !Array.isArray(eventIds) || eventIds.length === 0) return;
  try {
    await fetch('/api/chat/ack', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ sessionId, eventIds })
    });
  } catch {
    // best-effort — the next reconnect's replay is handled by frontend dedup
  }
}

// v10.16: Manual context compaction — triggered by user via /compactar command or button
// (W10-T2: auto-compact on context limit goes through the soul directly, not this API)
export async function compactSession(sessionId, userId = 'luna-default', onEvent) {
  const res = await fetch('/api/luna/compact', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ sessionId, userId })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Erro ao compactar' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  // Server returns SSE text/event-stream — read line by line
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) {
        try {
          const event = JSON.parse(trimmed.slice(5).trim());
          if (onEvent) onEvent(event);
          if (event.type === 'done' || event.type === 'compact_end' || event.type === 'compact_error') {
            return event;
          }
        } catch (e) {
          // ignore parse errors
        }
      }
    }
  }
  return { type: 'done' };
}

export async function fetchSessions() {
  try {
    const res = await fetch('/api/chat/sessions', { headers: authHeaders(false) });
    return res.json();
  } catch {
    return { ok: true, sessions: [] };
  }
}

export async function sessionAction(action, sessionId, title, provider) {
  const body = { action, sessionId };
  if (title !== undefined) body.title = title;
  if (provider !== undefined) body.provider = provider;
  const res = await fetch('/api/chat/session', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body)
  });
  return res.json();
}

export async function exportSessions(sessionIds, format = 'json') {
  const res = await fetch('/api/chat/export', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ sessionIds, format })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Erro ao exportar' }));
    throw new Error(err.error || 'Erro ao exportar');
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : `luna-export.${format === 'markdown' ? 'md' : format}`;
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
  return { ok: true };
}

// ============================================================
// Heartbeat — keep agent page alive (persistent mode)
// ============================================================
let heartbeatTimer = null;

export function startHeartbeat(userId = 'web-default', intervalMs = 30000) {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(async () => {
    try {
      await fetch('/api/system/heartbeat', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ userId })
      });
    } catch (e) {
      // Silently fail — heartbeat is best-effort
    }
  }, intervalMs);
}

export function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

export async function turnOffAgent(userId = 'web-default') {
  stopHeartbeat();
  const res = await fetch('/api/system/turnoff', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ userId })
  });
  return res.json();
}

export async function fetchSessionMessages(sessionId) {
  try {
    const res = await fetch(`/api/chat/session/${encodeURIComponent(sessionId)}/messages`, {
      headers: authHeaders(false)
    });
    return res.json();
  } catch {
    return { ok: false, messages: [] };
  }
}

export async function fetchConfig() {
  try {
    const res = await fetch('/api/config', { headers: authHeaders(false) });
    return res.json();
  } catch {
    return {};
  }
}

export async function saveConfig(config) {
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(config)
  });
  return res.json();
}

export async function login(username, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return res.json();
}

export async function logout() {
  localStorage.removeItem('luna_token');
}

export async function fetchMe() {
  const token = localStorage.getItem('luna_token');
  if (!token) return null;
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.status === 401) {
      // Token expired or invalid — clear it and force re-login
      localStorage.removeItem('luna_token');
      return null;
    }
    const data = await res.json();
    if (data.ok && data.user) return data.user;
    return null;
  } catch {
    // Backend offline — dev fallback only when unreachable
    return { id: 'dev', name: 'Dev User', email: 'dev@local', role: 'admin' };
  }
}

// Global 401 handler: intercept fetch responses and clear expired tokens.
// Wave 4 bug 9: NO page reload on 401 — a reload killed in-flight SSE
// streams and wiped client state without warning. Clearing the user store
// makes App.svelte show the login screen reactively; chat state in stores
// survives for the next login.
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  const res = await originalFetch.apply(this, args);
  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
  if (shouldForceLogout({ status: res.status, url, hasToken: !!localStorage.getItem('luna_token') })) {
    localStorage.removeItem('luna_token');
    user.set(null);
    console.warn('[auth] Sessão expirada (401). Faça login novamente.');
  }
  return res;
};

// ============================================================
// Plan Mode API
// ============================================================

export async function startPlanMode(message, sessionId) {
  console.log('[startPlanMode] fetch /api/plan', { message: message.slice(0, 80), sessionId });
  const res = await fetch('/api/plan', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ message, sessionId })
  });
  console.log('[startPlanMode] response', res.status);
  return res.json();
}

export async function approvePlan(sessionId) {
  const res = await fetch('/api/plan/approve', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ sessionId })
  });
  return res.json();
}

export async function rejectPlan(sessionId) {
  const res = await fetch('/api/plan/reject', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ sessionId })
  });
  return res.json();
}

export async function submitRevision(sessionId, revisedPlan) {
  const res = await fetch('/api/plan/revise', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ sessionId, revisedPlan })
  });
  return res.json();
}

// ============================================================
// System Commands API
// ============================================================

export async function systemRestart() {
  const res = await fetch('/api/system/restart', { method: 'POST', headers: authHeaders(false) });
  return res.json();
}

export async function systemStop() {
  const res = await fetch('/api/system/stop', { method: 'POST', headers: authHeaders(false) });
  return res.json();
}

export async function systemStart() {
  const res = await fetch('/api/system/start', { method: 'POST', headers: authHeaders(false) });
  return res.json();
}

export async function systemStatus() {
  const res = await fetch('/api/system/status', { headers: authHeaders(false) });
  return res.json();
}

// v10.2: Agent status polling
export async function agentStatus() {
  const res = await fetch('/api/system/agent', { headers: authHeaders(false) });
  return res.json();
}

export async function setVisibleMode(visible) {
  const endpoint = visible ? '/api/system/visible' : '/api/system/invisible';
  const res = await fetch(endpoint, { method: 'POST', headers: authHeaders(false) });
  return res.json();
}

export async function fetchPersonas() {
  try {
    const res = await fetch('/api/personas', { headers: authHeaders(false) });
    return res.json();
  } catch {
    return { ok: false, personas: [] };
  }
}

export async function fetchProviders() {
  try {
    const res = await fetch('/api/providers', { headers: authHeaders(false) });
    return res.json();
  } catch {
    return { ok: false, providers: [] };
  }
}

export async function setSessionProvider(sessionId, provider) {
  const res = await fetch('/api/chat/session', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ action: 'setProvider', sessionId, provider })
  });
  return res.json();
}

export async function setSessionPersona(sessionId, persona) {
  const res = await fetch('/api/chat/session', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ action: 'setPersona', sessionId, persona })
  });
  return res.json();
}

export async function systemHealth() {
  const res = await fetch('/api/system/health', { headers: authHeaders(false) });
  return res.json();
}

// v10.30: targeted self-heal — restart only the diagnosed-broken services
export async function selfhealServices(services) {
  const res = await fetch('/api/system/selfheal', {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ services })
  });
  return res.json();
}

export async function systemLogs(lines = 50) {
  const res = await fetch(`/api/system/logs?lines=${lines}`, { headers: authHeaders(false) });
  return res.json();
}

export async function testConnection(type, token) {
  const res = await fetch('/api/system/test-connection', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ type, token }),
  });
  return res.json();
}

export async function executeLunaTool(tool, params = {}) {
  const res = await fetch('/api/luna/execute', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ tool, params }),
  });
  return res.json();
}

// v3.3: resolve a pending destructive-operation confirmation (Confirm/Cancel)
export async function confirmToolAction(sessionId, confirmationId, action = 'confirm') {
  const res = await fetch('/api/luna/confirm', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ sessionId, confirmationId, action }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Erro ao confirmar' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function downloadSelfHost() {
  const res = await fetch('/api/selfhost/download', { method: 'POST', headers: authHeaders(false) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Erro desconhecido' }));
    throw new Error(err.error || 'Erro ao baixar pacote');
  }
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'luna-selfhost.zip';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
  return { ok: true };
}

// Luna Extension — Offscreen Document
// v8.0: Persistent WebSocket connection to Luna Server
// This runs in a hidden offscreen document to survive MV3 Service Worker termination

const LUNA_WS_URL = 'ws://localhost:3458/ext/ws';
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 30000;
const HEARTBEAT_TIMEOUT_MS = 10000;

let ws = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let heartbeatInterval = null;
let heartbeatTimeout = null;
let isConnected = false;
let messageBuffer = [];
let sessionId = null;

// ── WebSocket Management ──
function connect() {
  if (ws?.readyState === WebSocket.CONNECTING || ws?.readyState === WebSocket.OPEN) {
    return;
  }

  try {
    const url = sessionId
      ? `${LUNA_WS_URL}?sessionId=${encodeURIComponent(sessionId)}`
      : LUNA_WS_URL;

    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log('[Luna Offscreen] WebSocket connected');
      isConnected = true;
      reconnectAttempts = 0;
      startHeartbeat();

      // Signal ready to background
      chrome.runtime.sendMessage({ type: 'offscreen_ready' }).catch(() => {});

      // Flush buffered messages
      if (messageBuffer.length > 0) {
        for (const msg of messageBuffer) {
          send(msg);
        }
        messageBuffer = [];
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Cancel heartbeat timeout on any server response (including heartbeat_ack)
        if (heartbeatTimeout) {
          clearTimeout(heartbeatTimeout);
          heartbeatTimeout = null;
        }

        // Forward server responses to background for routing to tabs
        chrome.runtime.sendMessage({
          type: 'server_response',
          payload: data
        }).catch(() => {});
      } catch (e) {
        console.warn('[Luna Offscreen] Invalid JSON from server:', event.data.slice(0, 200));
      }
    };

    ws.onclose = (event) => {
      console.log('[Luna Offscreen] WebSocket closed', event.code, event.reason);
      isConnected = false;
      stopHeartbeat();
      scheduleReconnect();

      // Notify background
      chrome.runtime.sendMessage({ type: 'offscreen_disconnected' }).catch(() => {});
    };

    ws.onerror = (error) => {
      console.error('[Luna Offscreen] WebSocket error');
      isConnected = false;
    };
  } catch (e) {
    console.error('[Luna Offscreen] Failed to create WebSocket:', e.message);
    scheduleReconnect();
  }
}

function disconnect() {
  stopHeartbeat();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  isConnected = false;
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts), RECONNECT_MAX_MS);
  reconnectAttempts++;

  console.log(`[Luna Offscreen] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

// ── Send ──
function send(payload) {
  if (isConnected && ws?.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch (e) {
      console.error('[Luna Offscreen] Send failed:', e.message);
    }
  }
  // Buffer for later
  messageBuffer.push(payload);
  if (messageBuffer.length > 500) {
    // Prevent unbounded growth
    messageBuffer = messageBuffer.slice(-400);
    console.warn('[Luna Offscreen] Buffer overflow, dropped oldest messages');
  }
  return false;
}

// ── Heartbeat ──
function startHeartbeat() {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    send({ type: 'heartbeat', timestamp: Date.now() });
    heartbeatTimeout = setTimeout(() => {
      console.warn('[Luna Offscreen] Heartbeat timeout — forcing reconnect');
      disconnect();
      connect();
    }, HEARTBEAT_TIMEOUT_MS);
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (heartbeatTimeout) {
    clearTimeout(heartbeatTimeout);
    heartbeatTimeout = null;
  }
}

// ── Message Handling from Background ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'forward_to_server') {
    const success = send(message.payload);
    sendResponse({ ok: true, sent: success, buffered: !success });
    return false;
  }

  if (message.type === 'get_status') {
    sendResponse({
      connected: isConnected,
      buffered: messageBuffer.length,
      sessionId,
      wsState: ws?.readyState ?? -1
    });
    return false;
  }

  return false;
});

// ── Initialize ──
connect();

console.log('[Luna Offscreen] Loaded v8.0');

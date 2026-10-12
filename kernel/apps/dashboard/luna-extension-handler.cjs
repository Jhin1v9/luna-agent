/**
 * Luna Extension Handler v8.1
 * Manages connections from the Chrome Extension via HTTP polling + WebSocket fallback
 * Routes DOM events to Luna Soul for execution
 */

const EventEmitter = require('events');
const crypto = require('crypto');

class LunaExtensionHandler extends EventEmitter {
  constructor(httpServer, expressApp, lunaSoul) {
    super();
    this.lunaSoul = lunaSoul;
    this.sessions = new Map(); // sessionId -> { connectedAt, lastPing, messages: [], ws: null }
    this.processedToolCalls = new Map(); // toolKey -> timestamp (deduplication with TTL)
    this.setupHttpRoutes(expressApp || httpServer);
    console.log('[LunaExt] HTTP extension endpoints ready at /ext/*');
  }

  // v8.6: Global event buffer for bridge Layer 0 consumption
  _ensureEventBuffer() {
    if (!global.__lunaExtensionEventBuffers) {
      global.__lunaExtensionEventBuffers = new Map(); // sessionId -> [{eventType, data, ts}]
    }
  }

  _bufferEvent(sessionId, event) {
    this._ensureEventBuffer();
    const buf = global.__lunaExtensionEventBuffers.get(sessionId) || [];
    buf.push({ ...event, bufferedAt: Date.now() });
    // Keep only last 200 events to prevent unbounded growth
    if (buf.length > 200) buf.splice(0, buf.length - 200);
    global.__lunaExtensionEventBuffers.set(sessionId, buf);
  }

  // Called by bridge to consume buffered events
  getEvents(sessionId, clear = true) {
    this._ensureEventBuffer();
    const buf = global.__lunaExtensionEventBuffers.get(sessionId);
    if (!buf || buf.length === 0) return [];
    const events = buf.slice();
    if (clear) global.__lunaExtensionEventBuffers.set(sessionId, []);
    return events;
  }

  // Get events from all active extension sessions (for bridge when userId mapping is unknown)
  getAllEvents(clear = true) {
    this._ensureEventBuffer();
    const all = [];
    for (const [sessionId, session] of this.sessions) {
      if (this.isExtensionConnected(sessionId)) {
        const events = this.getEvents(sessionId, clear);
        for (const ev of events) all.push({ ...ev, _extSessionId: sessionId });
      }
    }
    return all;
  }

  setupHttpRoutes(appOrServer) {
    const express = require('express');
    const app = appOrServer;

    // Parse JSON body
    app.use('/ext', express.json());

    // Register session
    app.post('/ext/register', (req, res) => {
      const { sessionId, type } = req.body;
      if (!sessionId) {
        return res.status(400).json({ error: 'sessionId required' });
      }
      this.sessions.set(sessionId, {
        connectedAt: Date.now(),
        lastPing: Date.now(),
        messages: [],      // { id, payload, delivered, deliveredAt }
        deliveredIds: new Set(),
        ws: null,
        type: type || 'unknown'
      });
      console.log(`[LunaExt] Session registered: ${sessionId}`);
      res.json({ ok: true, sessionId });
    });

    // Receive event from extension
    app.post('/ext/event', (req, res) => {
      const { sessionId, ...eventData } = req.body;      if (!sessionId) {
        return res.status(400).json({ error: 'sessionId required' });
      }
      // v11.8-fix: auto-register extension sessions after server restart. The
      // extension keeps reusing its stored sessionId; instead of rejecting it,
      // recreate the session on the fly so DOM events keep flowing.
      if (!this.sessions.has(sessionId)) {
        console.log(`[LunaExt] Auto-registering session after restart: ${sessionId}`);
        this.sessions.set(sessionId, {
          connectedAt: Date.now(),
          lastPing: Date.now(),
          messages: [],
          deliveredIds: new Set(),
          ws: null,
          type: 'extension'
        });
      }

      const session = this.sessions.get(sessionId);
      session.lastPing = Date.now();

      this._handleEvent(sessionId, eventData);
      res.json({ ok: true });
    });

    // Poll for server messages
    app.get('/ext/poll', (req, res) => {
      const { sessionId } = req.query;
      if (!sessionId) {
        return res.status(400).json({ error: 'sessionId required' });
      }
      // v11.8-fix: auto-register on poll too, so the extension can pull
      // server messages immediately after a server restart.
      if (!this.sessions.has(sessionId)) {
        console.log(`[LunaExt] Auto-registering session on poll: ${sessionId}`);
        this.sessions.set(sessionId, {
          connectedAt: Date.now(),
          lastPing: Date.now(),
          messages: [],
          deliveredIds: new Set(),
          ws: null,
          type: 'extension'
        });
      }

      const session = this.sessions.get(sessionId);
      session.lastPing = Date.now();

      // Return only undelivered messages, mark them as delivered
      const undelivered = session.messages.filter(m => !m.delivered);
      const payloadOnly = [];
      for (const msg of undelivered) {
        msg.delivered = true;
        msg.deliveredAt = Date.now();
        session.deliveredIds.add(msg.id);
        payloadOnly.push(msg.payload);
      }

      // Periodic cleanup: remove old delivered messages from array to prevent unbounded growth
      if (session.messages.length > 100) {
        session.messages = session.messages.filter(m => !m.delivered);
      }

      res.json({ ok: true, messages: payloadOnly });
    });

    // Send message to extension (for internal use)
    app.post('/ext/send', (req, res) => {
      const { sessionId, payload } = req.body;
      if (!sessionId || !this.sessions.has(sessionId)) {
        return res.status(400).json({ error: 'invalid session' });
      }
      this._sendToSession(sessionId, payload);
      res.json({ ok: true });
    });
  }

  _handleEvent(sessionId, eventData) {
    const { eventType, data, timestamp, url, tabId, tabUrl } = eventData;

    // Store tabId in session for routing responses back
    const session = this.sessions.get(sessionId);
    if (session && tabId) {
      session.tabId = tabId;
    }

    // v8.6: Buffer DOM events for bridge Layer 0 consumption
    // v11.6: added thinking_start so the bridge can create the bubble immediately.
    // v11.8-fix: added thinking_update so the bridge can forward Kimi's full reasoning
    // text to the frontend as a source-of-truth replacement.
    const bufferableTypes = ['stream_state', 'thinking_start', 'thinking_update', 'stream_end', 'tool_call_detected', 'tool_response_detected', 'segment_complete', 'json_block_added', 'button_state'];
    if (bufferableTypes.includes(eventType)) {
      this._bufferEvent(sessionId, { eventType, data, timestamp, url, tabId, tabUrl });
    }

    if (eventType === 'tool_call_detected') {
      console.log(`[LunaExt] Tool call detected: ${data.tool} (session=${sessionId})`);
    } else if (eventType === 'stream_end') {
      console.log(`[LunaExt] Stream ended (session=${sessionId})`);
    } else if (eventType === 'stream_state') {
      // Debug logging only — actual consumption is via buffer
      if (data && data.response !== undefined) {
        console.log(`[LunaExt] Stream state: thinking=${(data.thinking||'').length} response=${(data.response||'').length} isStreaming=${data.isStreaming} (session=${sessionId})`);
      }
    }

    this.emit('event', {
      sessionId,
      eventType,
      data,
      timestamp,
      url,
      tabId,
      tabUrl
    });

    if (eventType === 'tool_call_detected' && data.tool && this.toolExecutor) {
      // Deduplicate tool calls within a TTL window (safety net against extension duplicates)
      const toolKey = `${sessionId}::${data.tool}::${JSON.stringify(data.params || {})}`;
      const now = Date.now();
      const lastSeen = this.processedToolCalls.get(toolKey);
      if (lastSeen && (now - lastSeen < 30000)) {
        console.log(`[LunaExt] Duplicate tool_call_detected ignored: ${data.tool} (session=${sessionId})`);
        return;
      }
      this.processedToolCalls.set(toolKey, now);

      // Periodic cleanup of old dedup entries
      if (this.processedToolCalls.size > 500) {
        const cutoff = now - 300000; // 5 min
        for (const [k, v] of this.processedToolCalls) {
          if (v < cutoff) this.processedToolCalls.delete(k);
        }
      }

      // v10.7-fix: Emit tool execution events so frontend can show tool cards
      this.emit('tool_executed', {
        sessionId,
        tool: data.tool,
        params: data.params,
        timestamp: Date.now()
      });

      this.toolExecutor(data.tool, data.params, sessionId)
        .then(result => {
          // v10.7-fix: Emit tool completion event
          this.emit('tool_completed', {
            sessionId,
            tool: data.tool,
            params: data.params,
            result,
            timestamp: Date.now()
          });
          this._sendToSession(sessionId, {
            type: 'tool_result',
            tool: data.tool,
            params: data.params,
            result,
            timestamp: Date.now()
          });
        })
        .catch(e => {
          console.error(`[LunaExt] Tool execution failed:`, e.message);
          // v10.7-fix: Emit tool error event
          this.emit('tool_completed', {
            sessionId,
            tool: data.tool,
            params: data.params,
            result: { success: false, error: e.message },
            timestamp: Date.now()
          });
          this._sendToSession(sessionId, {
            type: 'tool_error',
            tool: data.tool,
            error: e.message,
            timestamp: Date.now()
          });
        });
    }
  }

  _sendToSession(sessionId, payload) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    // Include tabId in payload for routing back to extension
    const enrichedPayload = {
      ...payload,
      tabId: payload.tabId || session.tabId
    };

    // Generate deterministic hash key for deduplication
    const hashInput = `${enrichedPayload.type}::${enrichedPayload.tool || ''}::${JSON.stringify(enrichedPayload.params || enrichedPayload.result || '')}::${Date.now()}`;
    const messageId = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 16);

    // Skip if this exact message was already delivered to this session
    if (session.deliveredIds.has(messageId)) {
      console.log(`[LunaExt] Duplicate message skipped (already delivered): ${messageId}`);
      return false;
    }

    // Queue message for polling
    session.messages.push({
      id: messageId,
      payload: enrichedPayload,
      delivered: false,
      queuedAt: Date.now()
    });

    // If using WebSocket, send immediately
    if (session.ws && session.ws.readyState === 1) {
      try {
        session.ws.send(JSON.stringify(enrichedPayload));
      } catch (e) {}
    }
    return true;
  }

  setToolExecutor(executorFn) {
    // v12.0: SINGLE WRITER — the extension is now observer-only. Direct tool
    // execution through this handler used to run the SAME tool the soul was
    // already running and injected the result into the Kimi input in parallel
    // with the bridge's own send (two writers, one contenteditable → messages
    // erased/replaced each other). Default OFF; set LUNA_EXT_DIRECT_EXEC=1 to
    // re-enable the legacy fast path for debugging.
    if (process.env.LUNA_EXT_DIRECT_EXEC !== '1') {
      console.log('[LunaExt] Direct tool execution DISABLED (single-writer mode — soul/bridge only). Set LUNA_EXT_DIRECT_EXEC=1 to re-enable.');
      this.toolExecutor = null;
      return;
    }
    console.log('[LunaExt] WARNING: direct tool execution enabled (legacy dual-writer mode)');
    this.toolExecutor = executorFn;
  }

  isExtensionConnected(sessionId) {
    const session = this.sessions.get(sessionId);
    return session && (Date.now() - session.lastPing < 60000);
  }

  getConnectedSessions() {
    return Array.from(this.sessions.keys()).filter(id => this.isExtensionConnected(id));
  }

  cleanup(maxAgeMs = 120000) {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastPing > maxAgeMs) {
        console.log(`[LunaExt] Cleaning stale session: ${sessionId}`);
        this.sessions.delete(sessionId);
      }
    }
  }
}

module.exports = { LunaExtensionHandler };

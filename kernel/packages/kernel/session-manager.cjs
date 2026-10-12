/**
 * SessionManager — Gerenciamento de sessões persistentes em JSONL
 * Inspirado em: Claude Code (~/.claude/projects/), Kimi CLI (~/.kimi/sessions/)
 *
 * Formato JSONL (JSON Lines): append-only, crash-safe, streamable
 * Cada linha = um evento da conversa (user, assistant, tool_call, tool_result)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const lunaConfig = require('./config/luna-config');

const LUNA_DIR = lunaConfig.LUNA_DIR;
const SESSIONS_DIR = lunaConfig.PATHS.sessions;
const SESSION_INDEX = path.join(LUNA_DIR, 'session_index.json');
const CURRENT_SESSION_LINK = path.join(LUNA_DIR, 'current_session');

// Ensure directories exist on any machine
lunaConfig.ensureDir(LUNA_DIR);
lunaConfig.ensureDir(SESSIONS_DIR);

class SessionManager {
  constructor() {
    this.sessionsDir = SESSIONS_DIR;
    this.indexFile = SESSION_INDEX;
    this.currentLink = CURRENT_SESSION_LINK;
  }

  /** Generate a short unique session ID */
  _generateId() {
    return crypto.randomUUID().slice(0, 8) + '-' + crypto.randomUUID().slice(9, 13);
  }

  /** Get session directory path */
  _sessionDir(sessionId) {
    return path.join(this.sessionsDir, sessionId);
  }

  /** Get context.jsonl path */
  _contextFile(sessionId) {
    return path.join(this._sessionDir(sessionId), 'context.jsonl');
  }

  /** Get state.json path */
  _stateFile(sessionId) {
    return path.join(this._sessionDir(sessionId), 'state.json');
  }

  /** Read session index */
  _readIndex() {
    try {
      if (fs.existsSync(this.indexFile)) {
        return JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
      }
    } catch {}
    return { sessions: {}, lastUpdated: new Date().toISOString() };
  }

  /** Write session index */
  _writeIndex(index) {
    index.lastUpdated = new Date().toISOString();
    fs.writeFileSync(this.indexFile, JSON.stringify(index, null, 2));
  }

  /** Create a new session */
  createSession(options = {}) {
    const sessionId = options.id || this._generateId();
    const sDir = this._sessionDir(sessionId);

    if (!fs.existsSync(sDir)) {
      fs.mkdirSync(sDir, { recursive: true });
      fs.mkdirSync(path.join(sDir, 'attachments'), { recursive: true });
      fs.mkdirSync(path.join(sDir, 'checkpoints'), { recursive: true });
    }

    const state = {
      id: sessionId,
      title: options.title || 'Nova sessão',
      mode: options.mode || 'thinking',
      persona: options.persona || 'default',
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      messageCount: 0,
      yoloMode: options.yoloMode || false,
      activeSkills: Array.isArray(options.activeSkills) ? options.activeSkills : [],
      metadata: options.metadata || {},
    };

    fs.writeFileSync(this._stateFile(sessionId), JSON.stringify(state, null, 2));

    // Initialize empty context.jsonl if not exists
    const ctxFile = this._contextFile(sessionId);
    if (!fs.existsSync(ctxFile)) {
      fs.writeFileSync(ctxFile, '');
    }

    // Update index
    const index = this._readIndex();
    index.sessions[sessionId] = {
      id: sessionId,
      title: state.title,
      createdAt: state.createdAt,
      lastAccessedAt: state.lastAccessedAt,
      messageCount: 0,
    };
    this._writeIndex(index);

    // Set as current session
    this._setCurrentSession(sessionId);

    return state;
  }

  /** Get current session ID from symlink */
  getCurrentSessionId() {
    try {
      if (fs.existsSync(this.currentLink)) {
        const target = fs.readlinkSync(this.currentLink);
        return path.basename(target);
      }
    } catch {}
    return null;
  }

  /** Set current session symlink */
  _setCurrentSession(sessionId) {
    try {
      if (fs.existsSync(this.currentLink)) {
        fs.unlinkSync(this.currentLink);
      }
      fs.symlinkSync(this._sessionDir(sessionId), this.currentLink);
    } catch (e) {
      // Fallback: write to a file if symlink fails
      fs.writeFileSync(this.currentLink, sessionId);
    }
  }

  /** Load session state */
  loadSession(sessionId) {
    const stateFile = this._stateFile(sessionId);
    if (!fs.existsSync(stateFile)) {
      return null;
    }
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      state.lastAccessedAt = new Date().toISOString();
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
      return state;
    } catch {
      return null;
    }
  }

  /** Get or create current session */
  getOrCreateCurrentSession(options = {}) {
    const currentId = this.getCurrentSessionId();
    if (currentId) {
      const existing = this.loadSession(currentId);
      if (existing) return existing;
    }
    return this.createSession(options);
  }

  /** Append event to context.jsonl */
  appendEvent(sessionId, event) {
    const sDir = this._sessionDir(sessionId);
    if (!fs.existsSync(sDir)) {
      fs.mkdirSync(sDir, { recursive: true });
      fs.mkdirSync(path.join(sDir, 'attachments'), { recursive: true });
      fs.mkdirSync(path.join(sDir, 'checkpoints'), { recursive: true });
    }
    const ctxFile = this._contextFile(sessionId);
    const line = JSON.stringify({ ...event, _ts: Date.now() }) + '\n';
    fs.appendFileSync(ctxFile, line);

    // Update state message count
    const state = this.loadSession(sessionId);
    if (state) {
      state.messageCount = (state.messageCount || 0) + 1;
      state.lastAccessedAt = new Date().toISOString();
      fs.writeFileSync(this._stateFile(sessionId), JSON.stringify(state, null, 2));
    }

    // Update index
    const index = this._readIndex();
    if (index.sessions[sessionId]) {
      index.sessions[sessionId].messageCount = state?.messageCount || 0;
      index.sessions[sessionId].lastAccessedAt = state?.lastAccessedAt;
      this._writeIndex(index);
    }
  }

  /** Read all events from context.jsonl */
  readContext(sessionId) {
    const ctxFile = this._contextFile(sessionId);
    if (!fs.existsSync(ctxFile)) return [];

    const lines = fs.readFileSync(ctxFile, 'utf8').split('\n').filter(Boolean);
    return lines.map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  }

  /** Read recent N events */
  readRecentEvents(sessionId, n = 50) {
    const all = this.readContext(sessionId);
    return all.slice(-n);
  }

  /** Backup context.jsonl before destructive operations (e.g. compaction) */
  backupContext(sessionId) {
    const ctxFile = this._contextFile(sessionId);
    if (!fs.existsSync(ctxFile)) return null;

    const sDir = this._sessionDir(sessionId);
    const backupsDir = path.join(sDir, 'backups');
    ensureDir(backupsDir);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupsDir, `context-${timestamp}.jsonl`);
    fs.copyFileSync(ctxFile, backupFile);
    return backupFile;
  }

  /** List all sessions */
  listSessions() {
    const index = this._readIndex();
    return Object.values(index.sessions).sort((a, b) => {
      return new Date(b.lastAccessedAt || 0) - new Date(a.lastAccessedAt || 0);
    });
  }

  /** Delete a session */
  deleteSession(sessionId) {
    const sDir = this._sessionDir(sessionId);
    if (fs.existsSync(sDir)) {
      fs.rmSync(sDir, { recursive: true });
    }
    const index = this._readIndex();
    delete index.sessions[sessionId];
    this._writeIndex(index);

    // If this was current, clear it
    if (this.getCurrentSessionId() === sessionId) {
      try { fs.unlinkSync(this.currentLink); } catch {}
    }
    return true;
  }

  /** Rename session */
  renameSession(sessionId, newTitle) {
    const state = this.loadSession(sessionId);
    if (!state) return false;
    state.title = newTitle;
    fs.writeFileSync(this._stateFile(sessionId), JSON.stringify(state, null, 2));

    const index = this._readIndex();
    if (index.sessions[sessionId]) {
      index.sessions[sessionId].title = newTitle;
      this._writeIndex(index);
    }
    return true;
  }

  /** Update session state with a patch object */
  updateSessionState(sessionId, patch) {
    const state = this.loadSession(sessionId);
    if (!state) return null;
    const updated = { ...state, ...patch, lastAccessedAt: new Date().toISOString() };
    fs.writeFileSync(this._stateFile(sessionId), JSON.stringify(updated, null, 2));
    const index = this._readIndex();
    if (index.sessions[sessionId]) {
      index.sessions[sessionId] = {
        ...index.sessions[sessionId],
        lastAccessedAt: updated.lastAccessedAt,
      };
      this._writeIndex(index);
    }
    return updated;
  }

  /** Export session to markdown */
  exportToMarkdown(sessionId, outputPath = null) {
    const state = this.loadSession(sessionId);
    if (!state) return null;

    const events = this.readContext(sessionId);
    const lines = [
      `# Sessão: ${state.title}`,
      ``,
      `- **ID:** ${sessionId}`,
      `- **Criada:** ${state.createdAt}`,
      `- **Mensagens:** ${events.length}`,
      `- **Modo:** ${state.mode}`,
      `- **Persona:** ${state.persona}`,
      ``,
      `---`,
      ``,
    ];

    for (const ev of events) {
      const time = ev.timestamp ? new Date(ev.timestamp).toLocaleString('pt-BR') : '';
      if (ev.type === 'user') {
        lines.push(`## 👤 Usuário (${time})`);
        lines.push(ev.content || '');
        lines.push('');
      } else if (ev.type === 'assistant') {
        lines.push(`## 🤖 Luna (${time})`);
        lines.push(ev.content || ev.response || '');
        lines.push('');
      } else if (ev.type === 'tool_call') {
        lines.push(`### 🔧 Tool: ${ev.tool || ev.action?.type}`);
        lines.push('```json');
        lines.push(JSON.stringify(ev.params || ev.action?.params || {}, null, 2));
        lines.push('```');
        lines.push('');
      } else if (ev.type === 'tool_result') {
        lines.push(`**Resultado:** ${ev.success !== undefined ? (ev.success ? '✅' : '❌') : ''}`);
        if (ev.output || ev.stdout) {
          lines.push('```');
          lines.push((ev.output || ev.stdout || '').slice(0, 500));
          lines.push('```');
        }
        lines.push('');
      }
    }

    const md = lines.join('\n');

    if (outputPath) {
      fs.writeFileSync(outputPath, md);
      return outputPath;
    }

    // Default export path
    const defaultPath = path.join(this._sessionDir(sessionId), 'transcript.md');
    fs.writeFileSync(defaultPath, md);
    return defaultPath;
  }

  /** Clear context but keep session */
  clearContext(sessionId) {
    const ctxFile = this._contextFile(sessionId);
    if (fs.existsSync(ctxFile)) {
      fs.writeFileSync(ctxFile, '');
    }
    const state = this.loadSession(sessionId);
    if (state) {
      state.messageCount = 0;
      fs.writeFileSync(this._stateFile(sessionId), JSON.stringify(state, null, 2));
    }
  }
}

module.exports = { SessionManager };

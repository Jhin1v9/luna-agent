/**
 * BridgeSessionManager — Extracted session/page management logic from kimi-bridge.cjs.
 *
 * Responsibilities:
 * 1. Manage user sessions: Map of userId -> { page, chatUrl, lastActivity, mode, context, processing }
 * 2. Get or create user page (reuse existing, create new if closed)
 * 3. Idle cleanup (close inactive pages after timeout)
 * 4. TTL-based session expiration
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function hashUserId(userId) {
  return crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 8);
}

class Semaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.waiters = [];
  }

  async acquire() {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release() {
    if (this.waiters.length > 0) {
      const next = this.waiters.shift();
      next();
    } else {
      this.current = Math.max(0, this.current - 1);
    }
  }
}

class BridgeSessionManager {
  /**
   * @param {import('playwright').Browser} browser
   * @param {import('playwright').BrowserContext} defaultContext
   * @param {object} store — session store with getUser(userId) / setUser(userId, info)
   * @param {object} logger — logger with info/warn/error/debug methods
   * @param {object} config — { idleTimeout, maxPages, ttl, ttlEnabled, persistentMode }
   */
  constructor(browser, defaultContext, store, logger, config = {}) {
    this.browser = browser;
    this.defaultContext = defaultContext;
    this.store = store;
    this.logger = logger;
    this.config = config;

    this.userSessions = new Map(); // userId -> { page, chatUrl, lastActivity, mode, context, processing, createdAt }
    this.persistentUserIds = new Set();
    this.idleTimer = null;
    this.idleTimeout = config.idleTimeout || 10 * 60 * 1000; // 10 min default
    this.maxPages = config.maxPages || 999;
    this.semaphore = new Semaphore(this.maxPages);
    this.ttlEnabled = config.ttlEnabled !== false;
    this.ttl = config.ttl || 24 * 60 * 60 * 1000; // 24h default
  }

  // ============================================================
  // SESSION CRUD
  // ============================================================

  getSession(userId) {
    return this.userSessions.get(userId);
  }

  setSession(userId, session) {
    this.userSessions.set(userId, session);
  }

  deleteSession(userId) {
    const session = this.userSessions.get(userId);
    if (session) {
      this._closeSessionPage(session);
      this.userSessions.delete(userId);
      this.semaphore.release();
    }
  }

  setPersistent(userId, persistent = true) {
    if (persistent) this.persistentUserIds.add(userId);
    else this.persistentUserIds.delete(userId);
  }

  // ============================================================
  // PAGE LIFECYCLE
  // ============================================================

  /**
   * Get or create a dedicated Page for a user.
   * Reuses existing page if still open.
   */
  async getOrCreatePage(userId) {
    const existing = this.userSessions.get(userId);
    if (existing && existing.page && !existing.page.isClosed()) {
      existing.lastActivity = Date.now();
      // Bridge hook: re-inject DOM/event observers here if needed
      return existing.page;
    }

    // v7.4-fix: If no existing session, try to reuse an existing page from defaultContext
    // that is already on kimi.ai. This avoids creating a duplicate tab.
    if (!existing || !existing.page || existing.page.isClosed()) {
      const pages = this.defaultContext?.pages() || [];
      for (const p of pages) {
        if (p.isClosed()) continue;
        // v8.7-fix: Skip pages already assigned to another user
        if (p._lunaUserId && p._lunaUserId !== userId) continue;
        try {
          const url = p.url();
          if (url && url.includes('kimi.ai')) {
            this.logger?.info?.(`Reusing existing kimi.ai page for user ${hashUserId(userId)}: ${url}`);
            p._lunaUserId = userId;
            const session = {
              page: p,
              context: this.defaultContext,
              chatUrl: url,
              lastActivity: Date.now(),
              processing: false,
              mode: this.store.getUser(userId)?.mode || 'instant',
              createdAt: existing?.createdAt || Date.now(),
            };
            this.userSessions.set(userId, session);
            this._saveChatUrl(userId, session.chatUrl, { mode: session.mode });
            await this._injectMasterLocalStorage(p);
            return p;
          }
        } catch (e) {
          // Page may be closing, skip
        }
      }
    }

    this.logger?.info?.(`Acquiring slot for user ${hashUserId(userId)} (${this.semaphore.current}/${this.maxPages})`);
    await this.semaphore.acquire();

    const stored = this.store.getUser(userId);
    const chatUrl = stored?.chatUrl || 'https://www.kimi.ai/?chat_enter_method=new_chat&lang=en';

    let page = null;
    try {
      this.logger?.info?.(`Creating new page for user ${hashUserId(userId)}`);
      page = await this.defaultContext.newPage();
      page._lunaUserId = userId;

      page.on('crash', () => {
        this.logger?.error?.(`Page crashed for user ${hashUserId(userId)}`);
        this.userSessions.delete(userId);
        this.semaphore.release();
      });

      await page.goto(chatUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Bridge hook: inject DOM observers / stream interceptors here if needed

      await this._injectMasterLocalStorage(page);

      // v3.9-fix: Verify login state after navigation. If logged out, re-inject cookies and reload.
      const isLoggedIn = await page.evaluate(() => {
        const hasLoginForm = !!(document.querySelector('form[action*="login"]') || document.querySelector('input[type="password"]'));
        const hasAppContent = !!(document.querySelector('.chat-editor, .markdown-container'));
        return !hasLoginForm && hasAppContent;
      }).catch(() => false);

      if (!isLoggedIn) {
        this.logger?.warn?.(`Page opened logged-out for ${hashUserId(userId)} — attempting cookie restore + reload...`);
        try {
          const masterPath = path.join(__dirname, '..', 'cookies', 'kimi-master-cookies.json');
          if (fs.existsSync(masterPath)) {
            const masterData = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
            const masterCookies = masterData.cookies || [];
            if (masterCookies.length > 0) {
              await this.defaultContext.addCookies(masterCookies);
              this.logger?.info?.(`Injected ${masterCookies.length} MASTER cookies before reload`);
            }
          }
        } catch (e) {
          this.logger?.warn?.(`Cookie restore before reload failed: ${e.message}`);
        }
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        await this._injectMasterLocalStorage(page);

        const stillLoggedOut = await page.evaluate(() => {
          const hasLoginForm = !!(document.querySelector('form[action*="login"]') || document.querySelector('input[type="password"]'));
          const hasAppContent = !!(document.querySelector('.chat-editor, .markdown-container'));
          return !hasLoginForm && !hasAppContent;
        }).catch(() => true);

        if (stillLoggedOut) {
          this.logger?.warn?.(`Still logged out after cookie reload — will try auto-login on next message`);
        } else {
          this.logger?.info?.(`Cookie restore + reload worked! User ${hashUserId(userId)} is now logged in.`);
        }
      }
    } catch (e) {
      this.logger?.warn?.(`Navigation failed for ${hashUserId(userId)}: ${e.message}`);
      if (page && !page.isClosed()) {
        try { await page.close(); } catch {}
      }
      this.semaphore.release();
      throw e;
    }

    const session = {
      page,
      context: this.defaultContext,
      chatUrl: page.url(),
      lastActivity: Date.now(),
      processing: false,
      mode: stored?.mode || 'instant',
      createdAt: Date.now(),
    };

    this.userSessions.set(userId, session);
    this._saveChatUrl(userId, session.chatUrl, { mode: session.mode });
    this.logger?.info?.(`Page ready for user ${hashUserId(userId)}: ${session.chatUrl}`);
    return page;
  }

  _closeSessionPage(session) {
    try {
      if (session.page && !session.page.isClosed()) {
        session.page.removeAllListeners('crash');
        session.page.close().catch((e) => this.logger?.warn?.(`Idle close error: ${e.message}`));
      }
    } catch (e) {
      this.logger?.warn?.(`Error closing page: ${e.message}`);
    }
  }

  _saveChatUrl(userId, url, extra = {}) {
    const isValid = url && url.includes('/chat/');
    if (!isValid) {
      this.logger?.warn?.(`Refusing to save invalid chatUrl: ${url} — keeping previous valid URL`);
      return;
    }
    this.store.setUser(userId, { chatUrl: url, ...extra });
  }

  async _injectMasterLocalStorage(page) {
    try {
      const masterPath = path.join(__dirname, '..', 'cookies', 'kimi-master-localstorage.json');
      if (!fs.existsSync(masterPath)) {
        this.logger?.warn?.('No master localStorage file found');
        return false;
      }
      const masterData = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
      const data = masterData.data || {};
      const keys = Object.keys(data);
      if (keys.length === 0) {
        this.logger?.warn?.('Master localStorage file is empty');
        return false;
      }
      await page.evaluate((items) => {
        for (const [key, value] of Object.entries(items)) {
          try { localStorage.setItem(key, value); } catch (e) {}
        }
      }, data);
      this.logger?.info?.(`Injected ${keys.length} localStorage items into page`);
      return true;
    } catch (e) {
      this.logger?.warn?.(`localStorage injection failed: ${e.message}`);
      return false;
    }
  }

  // ============================================================
  // IDLE CLEANUP + TTL
  // ============================================================

  startIdleCleanup() {
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = setInterval(() => {
      const now = Date.now();
      for (const [userId, session] of this.userSessions) {
        if (session.processing) continue;
        if (this.persistentUserIds.has(userId)) continue;

        if (this.config.persistentMode) {
          // In global persistent mode, only clean up if explicitly not persistent
          // and idle for > 3x the normal timeout
          if (now - session.lastActivity > this.idleTimeout * 3) {
            this.logger?.info?.(`Persistent mode: long-idle cleanup for user ${hashUserId(userId)}`);
          } else {
            continue;
          }
        }

        if (now - session.lastActivity > this.idleTimeout) {
          this.logger?.info?.(`Idle cleanup: closing page for user ${hashUserId(userId)}`);
          this._closeSessionPage(session);
          this.userSessions.delete(userId);
          this.semaphore.release();
          continue;
        }

        if (this.ttlEnabled && session.createdAt && (now - session.createdAt > this.ttl)) {
          this.logger?.info?.(`TTL expiration: closing page for user ${hashUserId(userId)}`);
          this._closeSessionPage(session);
          this.userSessions.delete(userId);
          this.semaphore.release();
        }
      }
    }, 60000); // Check every minute
  }

  stopIdleCleanup() {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

module.exports = { BridgeSessionManager, hashUserId, Semaphore };

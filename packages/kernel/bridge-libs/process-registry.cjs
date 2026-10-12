/**
 * ProcessRegistry — tracks Chrome PIDs for precise kill (no pkill -f broad).
 * Also tracks pages, contexts, browser for graceful shutdown.
 */
class ProcessRegistry {
  constructor() {
    this.pids = new Set();
    this.pages = new Map(); // userId -> Page
    this.contexts = new Set();
    this.browser = null;
  }

  registerPid(pid) {
    if (pid) this.pids.add(pid);
  }

  unregisterPid(pid) {
    this.pids.delete(pid);
  }

  setBrowser(browser) {
    this.browser = browser;
  }

  registerPage(userId, page) {
    this.pages.set(userId, page);
  }

  unregisterPage(userId) {
    this.pages.delete(userId);
  }

  registerContext(context) {
    this.contexts.add(context);
  }

  async shutdown(log = console) {
    log.info('[ProcessRegistry] Starting graceful shutdown...');

    // 1. Close pages
    for (const [userId, page] of this.pages) {
      try { await page.close({ runBeforeUnload: false }); } catch {}
    }
    this.pages.clear();

    // 2. Close contexts
    for (const ctx of this.contexts) {
      try { await ctx.close(); } catch {}
    }
    this.contexts.clear();

    // 3. Disconnect browser (don't kill, just disconnect CDP)
    if (this.browser) {
      try { await this.browser.close(); } catch {}
      this.browser = null;
    }

    // 4. Kill specific Chrome PIDs (no pkill -f)
    const { execSync } = require('child_process');
    for (const pid of this.pids) {
      try {
        process.kill(pid, 'SIGTERM');
        log.info(`[ProcessRegistry] Sent SIGTERM to Chrome PID ${pid}`);
      } catch {}
    }

    // Wait 3s then SIGKILL survivors
    await new Promise(r => setTimeout(r, 3000));
    for (const pid of this.pids) {
      try {
        process.kill(pid, 'SIGKILL');
        log.info(`[ProcessRegistry] Sent SIGKILL to Chrome PID ${pid}`);
      } catch {}
    }

    this.pids.clear();
    log.info('[ProcessRegistry] Graceful shutdown complete');
  }
}

module.exports = { ProcessRegistry };

/**
 * LoginManager — Extracted login checking & ensure-login logic for Kimi Web.
 *
 * Responsibilities:
 * 1. Check if a page is logged into Kimi Web using browser-native selectors.
 * 2. Navigate to kimi.ai if not logged in.
 * 3. Wait for login state to change (polling with absolute timeout).
 */

class LoginManager {
  /**
   * @param {object} logger  — logger with .info(), .warn() methods
   * @param {object} config  — optional config (reserved for future use)
   */
  constructor(logger, config = {}) {
    this.logger = logger;
    this.config = config;
  }

  /**
   * Check login state on a page using browser-native selectors (no :has-text()).
   * @param {import('playwright').Page} page
   * @returns {Promise<{loggedIn: boolean, hasLoginBtn: boolean, hasChatInput: boolean, hasLoginText: boolean, hasWelcome: boolean, url: string, error?: string}>}
   */
  async checkLoginState(page) {
    try {
      return await page.evaluate(() => {
        const bodyText = document.body?.innerText?.toLowerCase() || '';
        const hasLoginBtn = !!(
          document.querySelector('a[href*="login"], a[href*="signin"], button[class*="login"], button[class*="signin"]') ||
          document.querySelector('input[type="password"]')
        );
        const hasChatInput = !!(
          document.querySelector('textarea[placeholder], [contenteditable="true"]') ||
          document.querySelector('div[role="textbox"]')
        );
        const hasLoginText = bodyText.includes('log in') || bodyText.includes('sign in') || bodyText.includes('登录') || bodyText.includes('entrar');
        const hasWelcome = bodyText.includes('welcome') || bodyText.includes('kimi');
        const loggedIn = hasChatInput && !hasLoginText && !hasLoginBtn;
        return { loggedIn, hasLoginBtn, hasChatInput, hasLoginText, hasWelcome, url: location.href };
      });
    } catch (e) {
      return { loggedIn: false, hasLoginBtn: false, hasChatInput: false, hasLoginText: false, hasWelcome: false, url: page.url?.() || '', error: e.message };
    }
  }

  /**
   * Ensure the given page is logged into Kimi Web.
   * If not logged in, navigates to kimi.ai and polls until login is detected or timeout.
   *
   * @param {import('playwright').Page} page
   * @param {number} timeoutMs — absolute timeout in milliseconds (default: 30000)
   * @param {number} pollIntervalMs — polling interval in milliseconds (default: 2500)
   * @returns {Promise<{loggedIn: boolean, url: string, message?: string, action?: string, error?: string, lastState?: object}>}
   */
  async ensureLogin(page, timeoutMs = 30000, pollIntervalMs = 2500) {
    try {
      await page.bringToFront().catch(() => {});
    } catch (e) {
      return { loggedIn: false, url: page.url?.() || '', error: `Failed to bring page to front: ${e.message}`, action: 'login_required' };
    }

    // 1. Quick check before navigation
    const state = await this.checkLoginState(page);
    if (state.loggedIn) {
      return { loggedIn: true, url: state.url, message: 'Already logged in to Kimi Web' };
    }

    // 2. Not logged in — navigate to kimi.ai
    this.logger?.info?.('User not logged in, navigating to Kimi login page');
    try {
      await page.goto('https://www.kimi.ai/?lang=en', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(1500);
      await page.bringToFront().catch(() => {});
    } catch (e) {
      this.logger?.warn?.(`Navigation to www.kimi.ai failed: ${e.message}`);
      return { loggedIn: false, url: page.url?.() || '', error: `Failed to navigate: ${e.message}`, action: 'login_required' };
    }

    // 3. Poll until login detected or absolute timeout
    const start = Date.now();
    let lastState = null;

    while (Date.now() - start < timeoutMs) {
      const current = await this.checkLoginState(page);
      lastState = current;

      if (current.loggedIn) {
        return { loggedIn: true, url: current.url, message: 'Login detected! Ready to use.' };
      }

      const remaining = timeoutMs - (Date.now() - start);
      const sleep = Math.min(pollIntervalMs, remaining);
      if (sleep > 0) {
        await new Promise(r => setTimeout(r, sleep));
      }
    }

    return {
      loggedIn: false,
      url: lastState?.url || page.url?.() || '',
      message: 'Timed out waiting for login. Please log in manually in the opened browser.',
      action: 'login_timeout',
      lastState,
    };
  }
}

module.exports = { LoginManager };

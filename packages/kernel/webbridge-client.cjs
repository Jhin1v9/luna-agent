/**
 * WebBridge Client — v5.6
 * HTTP wrapper for Kimi WebBridge daemon (localhost:10086)
 * Replaces direct Playwright CDP for Kimi Web interactions.
 * Provides: navigate, snapshot, click, fill, upload, screenshot, evaluate
 */

const http = require('http');

const WEBBRIDGE_PORT = 10086;
const WEBBRIDGE_HOST = '127.0.0.1';

function webbridgeRequest(action, args = {}, session = 'luna-default') {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ action, args, session });
    const options = {
      hostname: WEBBRIDGE_HOST,
      port: WEBBRIDGE_PORT,
      path: '/command',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Invalid JSON from WebBridge: ${data}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

class WebBridgeClient {
  constructor(sessionName = 'luna-kimi') {
    this.session = sessionName;
    this.currentUrl = null;
  }

  async healthCheck() {
    try {
      const res = await webbridgeRequest('list_tabs', {}, this.session);
      return { ok: true, connected: true, response: res };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async navigate(url, newTab = true) {
    const res = await webbridgeRequest('navigate', { url, newTab, group_title: 'Luna Agent' }, this.session);
    if (res.success) this.currentUrl = url;
    return res;
  }

  async findTab(url, active = false) {
    return await webbridgeRequest('find_tab', { url, active }, this.session);
  }

  async snapshot() {
    return await webbridgeRequest('snapshot', {}, this.session);
  }

  async click(selector) {
    return await webbridgeRequest('click', { selector }, this.session);
  }

  async fill(selector, value) {
    return await webbridgeRequest('fill', { selector, value }, this.session);
  }

  async evaluate(code) {
    return await webbridgeRequest('evaluate', { code }, this.session);
  }

  async screenshot(options = {}) {
    return await webbridgeRequest('screenshot', options, this.session);
  }

  async upload(selector, files) {
    return await webbridgeRequest('upload', { selector, files }, this.session);
  }

  async listTabs() {
    return await webbridgeRequest('list_tabs', {}, this.session);
  }

  async closeTab() {
    return await webbridgeRequest('close_tab', {}, this.session);
  }

  async closeSession() {
    return await webbridgeRequest('close_session', {}, this.session);
  }

  /**
   * Send a message to Kimi Web using WebBridge.
   * Uses snapshot to find the input field, fill it, and click send.
   */
  async sendKimiMessage(text) {
    // Get snapshot to find input field
    const snap = await this.snapshot();
    if (!snap.tree) throw new Error('WebBridge snapshot failed');

    // Find input element — look for textarea or contenteditable
    const inputRef = this._findInputRef(snap.tree);
    if (!inputRef) throw new Error('Kimi input field not found in snapshot');

    // Fill the input
    await this.fill(inputRef, text);

    // Find send button
    const sendRef = this._findSendButtonRef(snap.tree);
    if (sendRef) {
      await this.click(sendRef);
    } else {
      // Fallback: press Enter via evaluate
      await this.evaluate(`
        const input = document.querySelector('textarea, [contenteditable="true"]');
        if (input) {
          const ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
          input.dispatchEvent(ev);
        }
      `);
    }

    return { success: true };
  }

  /**
   * Upload a file to Kimi Web using WebBridge.
   */
  async sendKimiFile(filePath, accompanyingText = '') {
    // Get snapshot to find file input
    const snap = await this.snapshot();

    // Try to find file input or upload button
    let uploadRef = this._findUploadButtonRef(snap.tree);

    if (uploadRef) {
      // Click upload button first (opens file picker or reveals input)
      await this.click(uploadRef);
      await this._sleep(1000);
    }

    // Re-snapshot to find the file input
    const snap2 = await this.snapshot();
    const fileInputRef = this._findFileInputRef(snap2.tree);

    if (fileInputRef) {
      await this.upload(fileInputRef, [filePath]);
    } else {
      // Fallback: try upload on the button ref itself
      if (uploadRef) {
        await this.upload(uploadRef, [filePath]);
      } else {
        throw new Error('Could not find upload element');
      }
    }

    // If there's accompanying text, fill the input
    if (accompanyingText) {
      await this._sleep(1000);
      const snap3 = await this.snapshot();
      const inputRef = this._findInputRef(snap3.tree);
      if (inputRef) {
        await this.fill(inputRef, accompanyingText);
      }
    }

    // Click send
    const snap4 = await this.snapshot();
    const sendRef = this._findSendButtonRef(snap4.tree);
    if (sendRef) await this.click(sendRef);

    return { success: true };
  }

  // ─── Helpers ─────────────────────────────────────────────

  // v5.6: Parse WebBridge accessibility tree (JSON array of nodes with role/name/ref/children)
  _findRefInTree(tree, matcherFn) {
    if (!tree) return null;
    const nodes = Array.isArray(tree) ? tree : [tree];
    for (const node of nodes) {
      if (matcherFn(node)) return node.ref || null;
      if (node.children) {
        const found = this._findRefInTree(node.children, matcherFn);
        if (found) return found;
      }
    }
    return null;
  }

  _findInputRef(tree) {
    return this._findRefInTree(tree, (node) =>
      node.role === 'textbox' || node.role === 'textarea' ||
      (node.name && /type a message|send a message|type \//i.test(node.name))
    );
  }

  _findSendButtonRef(tree) {
    return this._findRefInTree(tree, (node) =>
      node.role === 'button' && node.name &&
      /send|submit|➤|发送|enviar/i.test(node.name)
    );
  }

  _findUploadButtonRef(tree) {
    return this._findRefInTree(tree, (node) =>
      node.role === 'button' && node.name &&
      /upload|file|attachment|上传|anexo|➕|\+/i.test(node.name)
    );
  }

  _findFileInputRef(tree) {
    return this._findRefInTree(tree, (node) =>
      (node.role === 'none' || node.role === 'generic') && node.ref &&
      (!node.name || node.name === '')
    );
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

module.exports = { WebBridgeClient, webbridgeRequest };

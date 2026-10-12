// Luna Extension — Content Script (ISOLATED WORLD)
// v11.8: Injects observer into MAIN world, receives events via postMessage,
// forwards to background Service Worker for HTTP polling transmission.
// Also handles server responses: inserts tool results into Kimi textarea.
// v11.7-fix: Hardened against "Extension context invalidated" by checking
// chrome.runtime.id before every sendMessage and stopping forwarding cleanly.
// v11.8-fix: Submission tries Enter on the input first; button click is now the fallback.

(function() {
  'use strict';

  const SCRIPT_ID = '__luna-dom-observer-script';
  const INJECTED_SRC = chrome.runtime.getURL('injected.js');
  let isForwarding = true;

  // v11.6-fix: batch + throttle events from injected.js to background.
  // This prevents hundreds of sendMessage calls per second during fast streaming.
  const FORWARD_QUEUE = [];
  let forwardTimer = null;
  const MAX_BATCH_AGE_MS = 80;
  const MAX_BATCH_SIZE = 25;

  // v11.7-fix: MV3 content scripts lose their runtime context when the extension
  // is reloaded, disabled, or the service worker is terminated. Any call to
  // chrome.runtime.* throws synchronously while the JS context is still alive.
  function isExtensionContextValid() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  function stopForwarding() {
    isForwarding = false;
    if (forwardTimer) {
      clearTimeout(forwardTimer);
      forwardTimer = null;
    }
    FORWARD_QUEUE.length = 0;
  }

  function flushForwardQueue() {
    if (FORWARD_QUEUE.length === 0) return;
    if (!isExtensionContextValid()) {
      stopForwarding();
      return;
    }
    const batch = FORWARD_QUEUE.splice(0, FORWARD_QUEUE.length);
    try {
      chrome.runtime.sendMessage({ type: 'luna_event_batch', events: batch }).catch(() => {});
    } catch (e) {
      // Context invalidated while sending — stop forwarding silently.
      stopForwarding();
    }
  }

  function scheduleForward(event) {
    if (!isForwarding) return;
    if (!isExtensionContextValid()) {
      stopForwarding();
      return;
    }
    FORWARD_QUEUE.push(event);
    if (FORWARD_QUEUE.length >= MAX_BATCH_SIZE) {
      if (forwardTimer) clearTimeout(forwardTimer);
      forwardTimer = null;
      flushForwardQueue();
    } else if (!forwardTimer) {
      forwardTimer = setTimeout(() => {
        forwardTimer = null;
        flushForwardQueue();
      }, MAX_BATCH_AGE_MS);
    }
  }

  // v8.2-fix: Teardown old observer BEFORE injecting new one to prevent memory leak
  function teardownMainWorldObserver() {
    const script = document.createElement('script');
    script.textContent = `
      (function() {
        try {
          if (window.__lunaDomObserver && typeof window.__lunaDomObserver.teardown === 'function') {
            window.__lunaDomObserver.teardown();
          }
          if (window.__lunaUltraLightObserver && typeof window.__lunaUltraLightObserver.docObserver !== 'undefined') {
            window.__lunaUltraLightObserver.docObserver.disconnect();
            window.__lunaUltraLightObserver = undefined;
          }
          if (window.__lunaEventQueue) window.__lunaEventQueue = undefined;
        } catch (e) {}
      })();
    `;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  // ── Inject observer into MAIN world ──
  function injectObserver() {
    // If observer already exists and is healthy, don't re-inject
    if (window.__lunaDomObserver) {
      return;
    }

    const old = document.getElementById(SCRIPT_ID);
    if (old) old.remove();

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = INJECTED_SRC;
    script.type = 'text/javascript';
    script.async = false;
    (document.head || document.documentElement).appendChild(script);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectObserver);
  } else {
    injectObserver();
  }

  // v8.2-fix: SPA navigation — teardown old, then inject new. Prevents observer accumulation.
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function(...args) {
    originalPushState.apply(this, args);
    setTimeout(() => { teardownMainWorldObserver(); injectObserver(); }, 100);
  };

  history.replaceState = function(...args) {
    originalReplaceState.apply(this, args);
    setTimeout(() => { teardownMainWorldObserver(); injectObserver(); }, 100);
  };

  window.addEventListener('popstate', () => {
    setTimeout(() => { teardownMainWorldObserver(); injectObserver(); }, 100);
  });

  // v10.7-fix: Removed setInterval(30s) that caused memory pressure.
  // Observer re-injection is handled by SPA navigation hooks (pushState/replaceState/popstate)
  // and by the content script's own load. If the script is removed, page refresh restores it.

  // ── Provider-aware Input Injection ──
  function isDeepSeek() {
    const host = window.location.hostname;
    return host.includes('deepseek.com') || host.includes('deepseek.ai');
  }

  function findInput() {
    if (isDeepSeek()) {
      // DeepSeek uses a textarea in the bottom composer
      const textarea = document.querySelector('textarea[placeholder*="Message"], textarea[placeholder*="mensagem" i], textarea');
      if (textarea) return { element: textarea, type: 'textarea' };
      return null;
    }

    // Kimi: modern UI uses a contenteditable div or a textarea inside the composer.
    // Prefer an element with a prompt placeholder, then fall back to the composer,
    // then to any editable/text area.
    const composer = document.querySelector('.chat-input-container, .input-area, [class*="chat-input"], [class*="composer"]');

    if (composer) {
      const editable = composer.querySelector('[contenteditable="true"], [contenteditable="plaintext-only"]');
      if (editable) return { element: editable, type: 'contenteditable' };
      const textarea = composer.querySelector('textarea');
      if (textarea) return { element: textarea, type: 'textarea' };
    }

    const editableByPlaceholder = document.querySelector('[contenteditable="true"][placeholder], [contenteditable="plaintext-only"][placeholder]');
    if (editableByPlaceholder) return { element: editableByPlaceholder, type: 'contenteditable' };

    const textareaByPlaceholder = document.querySelector('textarea[placeholder*="Ask" i], textarea[placeholder*="Pergunte" i], textarea[placeholder*="Ask anything" i]');
    if (textareaByPlaceholder) return { element: textareaByPlaceholder, type: 'textarea' };

    const anyEditable = document.querySelector('[contenteditable="true"], [contenteditable="plaintext-only"]');
    if (anyEditable) return { element: anyEditable, type: 'contenteditable' };

    const anyTextarea = document.querySelector('textarea');
    if (anyTextarea) return { element: anyTextarea, type: 'textarea' };

    return null;
  }

  function setInputValue(input, text) {
    const el = input.element;
    el.focus();

    if (input.type === 'contenteditable') {
      // Lexical-safe fill: clear via execCommand, then insert the text as a
      // single composition so the editor state stays in sync.
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      // Fallback if execCommand didn't actually replace (some editors suppress it)
      if ((el.textContent || '').trim().length < text.trim().length * 0.5) {
        el.innerHTML = '';
        const span = document.createElement('span');
        span.textContent = text;
        el.appendChild(span);
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } else if (input.type === 'textarea') {
      el.value = text;
      el.selectionStart = el.selectionEnd = text.length;
    }

    const events = ['input', 'change', 'keyup', 'compositionend'];
    for (const eventType of events) {
      const evt = new InputEvent(eventType, { bubbles: true, cancelable: true });
      el.dispatchEvent(evt);
    }
  }

  function clickSendButton() {
    // v11.8-fix: pressing Enter is the most reliable submission mechanism across
    // Kimi/DeepSeek UI refreshes. Try it first, then fall back to clicking buttons.
    const input = findInput();
    if (input) {
      input.element.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true, composed: true
      }));
      input.element.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true, composed: true
      }));
      // Also emit an InputEvent so React/Vue inputs that gate submission on input
      // state see the value as "committed".
      input.element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
      return { method: 'enter-key' };
    }

    if (isDeepSeek()) {
      // DeepSeek send button is a primary circular div[role="button"]
      const candidates = document.querySelectorAll('div[role="button"]');
      for (const btn of candidates) {
        const cls = btn.className || '';
        const aria = btn.getAttribute('aria-label') || '';
        if (/ds-button--primary/.test(cls) || /send|enviar|发送|submit/i.test(aria)) {
          if (!btn.disabled && btn.getBoundingClientRect().width < 80) {
            btn.click();
            return { method: 'deepseek-primary-button' };
          }
        }
      }
    } else {
      // Kimi send button: look inside the composer first, then globally.
      const composer = document.querySelector('.chat-input-container, .input-area, [class*="chat-input"], [class*="composer"]');
      const buttonRoots = composer ? [composer, document] : [document];

      for (const root of buttonRoots) {
        const allButtons = root.querySelectorAll('button, div[role="button"]');
        for (const btn of allButtons) {
          const cls = (btn.className || '').toLowerCase();
          const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
          const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
          if (/send|enviar|发送|submit/i.test(aria) || /send/i.test(testId)) {
            if (!btn.disabled) {
              btn.click();
              return { method: 'kimi-aria-button' };
            }
          }
          const svg = btn.querySelector('svg');
          if (svg && !btn.disabled && (cls.includes('send') || cls.includes('submit') || btn.getBoundingClientRect().width < 60)) {
            btn.click();
            return { method: 'kimi-svg-button' };
          }
        }
      }
    }

    return { method: 'none', error: 'No send mechanism found' };
  }

  function waitForInput(maxMs = 3000) {
    return new Promise((resolve) => {
      const input = findInput();
      if (input) return resolve(input);
      const start = Date.now();
      const timer = setInterval(() => {
        const found = findInput();
        if (found) {
          clearInterval(timer);
          resolve(found);
        } else if (Date.now() - start > maxMs) {
          clearInterval(timer);
          resolve(null);
        }
      }, 100);
    });
  }

  async function injectToolResult(text) {
    try {
      const input = await waitForInput(3000);
      if (!input) {
        console.warn('[Luna Content] No input found for injection');
        return { ok: false, error: 'No input found' };
      }

      setInputValue(input, text);

      // Small delay to let React/Vue process
      await new Promise(r => setTimeout(r, 250));
      const result = clickSendButton();
      console.log('[Luna Content] Tool result sent:', result.method);

      return { ok: true };
    } catch (e) {
      console.error('[Luna Content] Failed to inject tool result:', e.message);
      return { ok: false, error: e.message };
    }
  }

  // ── Listen for events from injected.js ──
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.source !== 'luna-injected') return;
    if (!isForwarding) return;

    // v11.6-fix: accept both single events and batches from injected.js
    const incoming = event.data.type === 'luna_event_batch' && Array.isArray(event.data.events)
      ? event.data.events
      : [{ type: event.data.type, data: event.data.data, timestamp: event.data.timestamp, url: event.data.url }];

    for (const ev of incoming) {
      scheduleForward({
        eventType: ev.type,
        data: ev.data,
        timestamp: ev.timestamp || Date.now(),
        url: ev.url || event.data.url || window.location.href,
        version: event.data.version
      });
    }
  });

  // ── Listen for responses from server (via background) ──
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'luna_server_response') {
      const payload = message.payload;
      if (payload.type === 'tool_result' && payload.result) {
        const text = typeof payload.result === 'string'
          ? payload.result
          : JSON.stringify(payload.result, null, 2);
        injectToolResult(text).then(result => sendResponse(result));
        return true;
      }
      if (payload.type === 'inject_text' && payload.text) {
        injectToolResult(payload.text).then(result => sendResponse(result));
        return true;
      }
      console.log('[Luna Content] Server response (unhandled):', payload.type);
    }
    sendResponse({ ok: true });
    return false;
  });

  // ── Handle extension enable/disable ──
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'luna-content') {
      port.onDisconnect.addListener(() => {
        isForwarding = false;
      });
    }
  });

  console.log('[Luna Content] v11.7 loaded — forwarding DOM events + injection ready');
})();

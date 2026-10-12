(function setupLunaDomObserver() {
  if (window.__lunaDomObserver) return;

  const MAX_QUEUE_SIZE = 2000;
  const MAX_EVENT_AGE_MS = 30000;
  const DEBOUNCE_MS = 50;
  const IMPORTANT_TYPES = new Set(['tool_call', 'tool_response', 'segment_complete', 'stream_end', 'json_block_added']);
  const SELECTORS = {
    assistantSegment: '[data-testid="segment-assistant"], .assistant-segment, .segment-content',
    codeBlock: 'pre code, .segment-code, [class*="code"]',
    toolContainer: '[class*="toolcall"], .toolcall-ipython, .toolcall-web_search, .toolcall-web_open_url, .toolcall-search_image',
    sendButton: 'button[type="submit"], .send-btn, [data-testid="send-button"]',
    stopButton: 'button.stop-btn, .stop-generation, [data-testid="stop-button"]',
    thinking: '.thinking, [class*="thinking"], .segment-thinking, [class*="think-block"], [data-testid*="think"]',
    // v7.3-fix: textContent must NOT include generic [class*="content"] which can match thinking containers.
    // Use more specific selectors that only match actual response text containers.
    // Wave2-fix B: dropped .markdown-container — it's the PARENT of the leaf text
    // nodes, so querySelectorAll matched both and every paragraph was concatenated twice.
    textContent: '.segment-text, .message-content, [class*="segment-text"], [class*="message-content"]'
  };

  window.__lunaEventQueue = {
    _events: [],
    _maxSize: MAX_QUEUE_SIZE,
    _maxAgeMs: MAX_EVENT_AGE_MS,
    _lastSwapTs: 0,

    push(event) {
      try {
        const entry = { ts: Date.now(), type: event.type || 'unknown', data: event.data || {}, id: this._events.length };
        if (this._events.length >= this._maxSize) this._evict();
        this._events.push(entry);
      } catch (e) {}
    },

    _evict() {
      const now = Date.now();
      const cutoff = now - this._maxAgeMs;
      this._events = this._events.filter(ev => {
        if (IMPORTANT_TYPES.has(ev.type)) return true;
        return (ev.ts || 0) > cutoff;
      });
      if (this._events.length >= this._maxSize) {
        this._events.sort((a, b) => a.ts - b.ts);
        this._events = this._events.slice(-Math.floor(this._maxSize * 0.8));
      }
    },

    swap() {
      const batch = this._events;
      this._events = [];
      this._lastSwapTs = Date.now();
      return batch;
    },

    size() { return this._events.length; }
  };

  function debounce(fn, wait) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => { try { fn.apply(this, args); } catch (e) {} }, wait);
    };
  }

  function safeQuery(selector, root = document) {
    try { return root.querySelectorAll(selector); }
    catch (e) { return []; }
  }

  function safeText(el) {
    try { return (el.textContent || '').trim(); }
    catch (e) { return ''; }
  }

  function detectJsonBlocks(container) {
    const results = { actions: [], responses: [] };
    try {
      for (const block of safeQuery(SELECTORS.codeBlock, container)) {
        const text = safeText(block);
        if (!text || text.length < 10) continue;
        const isJsonLike = (text.startsWith('{') && text.includes('"')) || (text.startsWith('[') && text.includes('"'));
        if (!isJsonLike) continue;
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (e) {
          const m = text.match(/\{[\s\S]*?\}/);
          if (m) try { parsed = JSON.parse(m[0]); } catch (e2) { continue; }
          else continue;
        }
        if (!parsed) continue;
        if (parsed.tool !== undefined || parsed.action !== undefined) {
          results.actions.push({ tool: parsed.tool || parsed.action, params: parsed.params || parsed.arguments || parsed });
        } else if (parsed.response !== undefined || parsed.result !== undefined) {
          results.responses.push({ response: parsed.response || parsed.result });
        }
      }
    } catch (e) {}
    return results;
  }

  function detectButtonState() {
    const state = { sendVisible: false, stopVisible: false };
    try {
      const sendBtn = document.querySelector(SELECTORS.sendButton);
      const stopBtn = document.querySelector(SELECTORS.stopButton);
      if (sendBtn) state.sendVisible = window.getComputedStyle(sendBtn).display !== 'none' && sendBtn.offsetParent !== null;
      if (stopBtn) state.stopVisible = window.getComputedStyle(stopBtn).display !== 'none' && stopBtn.offsetParent !== null;
      if (!state.stopVisible) {
        const anyStop = document.querySelector('[class*="stop"], [aria-label*="stop"], [aria-label*="cancel"]');
        if (anyStop) state.stopVisible = window.getComputedStyle(anyStop).display !== 'none' && anyStop.offsetParent !== null;
      }
    } catch (e) {}
    return state;
  }

  function detectAssistantSegments(root) {
    const segments = [];
    try {
      for (const node of safeQuery(SELECTORS.assistantSegment, root)) {
        const text = safeText(node);
        const segId = node.getAttribute('data-segment-id') || node.getAttribute('id') || ('seg_' + Math.random().toString(36).slice(2, 8));
        const isNew = !node.__lunaObserved;
        if (isNew) { node.__lunaObserved = true; node.__lunaSegmentId = segId; }
        const jsonBlocks = detectJsonBlocks(node);
        segments.push({ id: segId, isNew, textLength: text.length, hasCodeBlocks: jsonBlocks.actions.length > 0 || jsonBlocks.responses.length > 0, toolCalls: jsonBlocks.actions, toolResponses: jsonBlocks.responses, isComplete: !node.classList.contains('streaming') && !node.querySelector('[class*="streaming"], [class*="loading"]') });
      }
    } catch (e) {}
    return segments;
  }

  function detectToolContainers(root) {
    const containers = [];
    try {
      for (const node of safeQuery(SELECTORS.toolContainer, root)) {
        const className = (node.className || '').toLowerCase();
        // v10.42-fix: Kimi renders the thinking step as a .toolcall-container.thinking-container.
        // It is NOT a real tool call and must not be executed.
        if (className.includes('thinking') || className.includes('reasoning')) continue;
        const type = (node.className || '').match(/toolcall-(\w+)/)?.[1] || 'unknown';
        const isNew = !node.__lunaObserved;
        if (isNew) node.__lunaObserved = true;
        containers.push({ type, isNew, status: node.getAttribute('data-status') || 'pending', textPreview: safeText(node).slice(0, 200) });
      }
    } catch (e) {}
    return containers;
  }

  let _lastStreamText = '';
  let _lastStreamTs = 0;

  function detectStreaming() {
    const info = { isStreaming: false, textDelta: '', thinking: '', response: '' };
    try {
      for (const node of safeQuery(SELECTORS.thinking)) { info.thinking += safeText(node) + ' '; }
      let currentText = '';
      for (const node of safeQuery(SELECTORS.textContent)) { currentText += safeText(node) + ' '; }
      const now = Date.now();
      if (currentText !== _lastStreamText) {
        info.textDelta = currentText.slice(_lastStreamText.length);
        info.isStreaming = true;
        _lastStreamText = currentText;
        _lastStreamTs = now;
      } else {
        info.isStreaming = (now - _lastStreamTs) < 3000;
      }
      info.response = currentText;
    } catch (e) {}
    return info;
  }

  function processMutations(mutations) {
    try {
      const queue = window.__lunaEventQueue;
      const now = Date.now();

      const segments = detectAssistantSegments(document.documentElement);
      for (const seg of segments) {
        if (seg.isNew) queue.push({ type: 'segment_complete', data: { segmentId: seg.id, textLength: seg.textLength, hasCodeBlocks: seg.hasCodeBlocks, toolCallsCount: seg.toolCalls.length, isComplete: seg.isComplete } });
        for (const tc of seg.toolCalls) queue.push({ type: 'tool_call', data: { segmentId: seg.id, tool: tc.tool, params: tc.params } });
        for (const tr of seg.toolResponses) queue.push({ type: 'tool_response', data: { segmentId: seg.id, response: tr.response } });
      }

      const tools = detectToolContainers(document.documentElement);
      for (const tc of tools) {
        if (tc.isNew) queue.push({ type: 'tool_container', data: { toolType: tc.type, status: tc.status, preview: tc.textPreview } });
      }

      const btnState = detectButtonState();
      const prevBtn = window.__lunaLastButtonState || {};
      if (btnState.stopVisible !== prevBtn.stopVisible || btnState.sendVisible !== prevBtn.sendVisible) {
        queue.push({ type: 'button_state', data: { sendVisible: btnState.sendVisible, stopVisible: btnState.stopVisible } });
        window.__lunaLastButtonState = btnState;
      }

      const streamInfo = detectStreaming();
      if (streamInfo.isStreaming && streamInfo.textDelta) {
        queue.push({ type: 'stream_chunk', data: { deltaLength: streamInfo.textDelta.length, thinking: streamInfo.thinking.slice(0, 200) } });
      }

      for (const m of mutations) {
        if (m.type === 'childList') {
          for (const added of m.addedNodes) {
            if (added.nodeType !== Node.ELEMENT_NODE) continue;
            for (const block of safeQuery('pre code, code', added)) {
              const text = safeText(block);
              if (text.includes('"tool"') || text.includes('"response"')) {
                const jsonResult = detectJsonBlocks(added);
                if (jsonResult.actions.length || jsonResult.responses.length) {
                  queue.push({ type: 'json_block_added', data: { actions: jsonResult.actions, responses: jsonResult.responses } });
                }
              }
            }
          }
        }
      }
    } catch (e) {}
  }

  const debouncedProcess = debounce(processMutations, DEBOUNCE_MS);
  const observer = new MutationObserver((mutations) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => debouncedProcess(mutations), { timeout: 100 });
    } else {
      setTimeout(() => debouncedProcess(mutations), 0);
    }
  });

  try {
    // v8.5-fix: REMOVED attributeOldValue — it forces the browser to clone old attribute
    // values on every mutation, causing massive memory pressure and GC pauses during Kimi streaming.
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-status', 'data-segment-id', 'style'] });
  } catch (e) {
    try { observer.observe(document.body, { childList: true, subtree: true, attributes: true }); } catch (e2) {}
  }

  const heartbeatInterval = setInterval(() => {
    try {
      const streamInfo = detectStreaming();
      const btnState = detectButtonState();
      const lastStream = window.__lunaLastStreamState || {};
      if (lastStream.isStreaming && !streamInfo.isStreaming && !btnState.stopVisible) {
        window.__lunaEventQueue.push({ type: 'stream_end', data: { finalTextLength: _lastStreamText.length } });
      }
      window.__lunaLastStreamState = { isStreaming: streamInfo.isStreaming };
    } catch (e) {}
  }, 2000);

  function teardown() {
    try {
      clearInterval(heartbeatInterval);
      observer.disconnect();
      delete window.__lunaEventQueue;
      delete window.__lunaDomObserver;
      delete window.__lunaLastButtonState;
      delete window.__lunaLastStreamState;
    } catch (e) {}
  }

  window.__lunaDomObserver = { observer, teardown, swap: () => window.__lunaEventQueue.swap(), stats: () => ({ queueSize: window.__lunaEventQueue.size(), isObserving: true, url: window.location.href }) };
  window.addEventListener('beforeunload', teardown, { once: true });

  // v7.0-fix: NEVER teardown on pushState/replaceState — SPA navigation on kimi.ai
  // kills the observer permanently. Instead, keep observer alive across navigations.
  // The bridge will reinject if needed, but teardown here makes it impossible.
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function (...args) {
    const result = originalPushState.apply(this, args);
    window.__lunaEventQueue.push({ type: 'spa_navigate', data: { method: 'pushState', url: window.location.href } });
    return result;
  };
  history.replaceState = function (...args) {
    const result = originalReplaceState.apply(this, args);
    window.__lunaEventQueue.push({ type: 'spa_navigate', data: { method: 'replaceState', url: window.location.href } });
    return result;
  };

  window.__lunaEventQueue.push({ type: 'observer_ready', data: { url: window.location.href, timestamp: Date.now() } });

  // ═══════════════════════════════════════════════════════════════════════
  // v8.5-fix: ULTRA-LIGHT MutationObserver for real-time streaming
  // Instead of observing the entire document (heavy), we observe ONLY the
  // last .segment-assistant element. This gives us instant notifications
  // when Kimi adds text, without competing with React's main thread.
  // ═══════════════════════════════════════════════════════════════════════
  (function setupUltraLightObserver() {
    if (window.__lunaUltraLightObserver) return;

    let _lastAssistant = null;
    let _lastText = '';
    let _lastThinking = '';
    let _observer = null;

    function findLastAssistant() {
      const assistants = document.querySelectorAll('.segment-assistant');
      return assistants.length > 0 ? assistants[assistants.length - 1] : null;
    }

    function extractText(assistant) {
      if (!assistant) return { thinking: '', response: '' };
      // Extract thinking
      let thinking = '';
      const thinkContainer = assistant.querySelector('.toolcall-container.thinking-container');
      if (thinkContainer) {
        const thinkMd = thinkContainer.querySelector('.markdown-container.toolcall-content-text');
        if (thinkMd) thinking = (thinkMd.textContent || '').trim();
      }
      // Extract response from markdown containers (excluding thinking)
      let response = '';
      const mdContainers = assistant.querySelectorAll('.markdown-container');
      for (const md of mdContainers) {
        if (thinkContainer && md.closest('.toolcall-container.thinking-container')) continue;
        const text = (md.textContent || '').trim();
        if (text) response += text + '\n';
      }
      return { thinking: thinking.trim(), response: response.trim() };
    }

    function onMutations() {
      const assistant = findLastAssistant();
      if (!assistant) return;

      // If assistant changed, re-observe
      if (assistant !== _lastAssistant) {
        if (_observer) _observer.disconnect();
        _lastAssistant = assistant;
        _lastText = '';
        _lastThinking = '';
        _observer = new MutationObserver(onMutations);
        _observer.observe(assistant, { childList: true, subtree: true, characterData: true });
      }

      const { thinking, response } = extractText(assistant);
      const queue = window.__lunaEventQueue;

      if (thinking && thinking !== _lastThinking) {
        queue.push({ type: 'thinking_delta', data: { text: thinking.slice(_lastThinking.length), fullThinking: thinking } });
        _lastThinking = thinking;
      }

      if (response && response !== _lastText) {
        queue.push({ type: 'response_delta', data: { text: response.slice(_lastText.length), fullResponse: response } });
        _lastText = response;
      }
    }

    // Observe the document for NEW assistants being added
    const docObserver = new MutationObserver(() => {
      onMutations();
    });
    docObserver.observe(document.body, { childList: true, subtree: true });

    // Initial scan
    onMutations();

    window.__lunaUltraLightObserver = { docObserver, onMutations };
  })();
})();

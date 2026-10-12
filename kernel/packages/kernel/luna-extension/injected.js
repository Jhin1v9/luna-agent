// Luna Extension — Injected into MAIN world of provider pages (kimi.ai, chat.deepseek.com, etc.)
// v2.5.2: Thinking/source-of-truth extraction based on Kimi's .thinking-container.
// Rule: text INSIDE the .thinking-container is reasoning; text OUTSIDE is the answer/tool.
// v11.7-fix: detect the thinking container as early as possible via a lightweight
// chat-container MutationObserver, so we capture the reasoning from the start instead
// of joining it mid-stream.
// v2.6.0: Robust thinking/response separation with expanded selectors and fallback heuristic.

(function setupLunaDomObserver() {
  // SENTINEL: Prova que este injected.js está sendo executado
  // Envia através do pipeline de eventos para o servidor
  const BUILD_SENTINEL = 'LUNA_INJECTED_BUILD_SENTINEL_2_9_3_20260816';
  const EXTENSION_URL = typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.getURL('') : 'unknown';

  if (window.__lunaDomObserver) {
    try { window.__lunaDomObserver.version = '2.6.0'; } catch (e) {}
    return;
  }

  const VERSION = '2.8.0';
  const POLL_MS = 80;           // read DOM every 80ms while generating
  const HEARTBEAT_MS = 600;     // full-state resync while streaming
  // v13.0 (F1.3): stream-end consensus signals. The button transition must
  // persist this long before it counts (React re-renders flicker it mid-stream);
  // inactivity is only the tertiary fallback, so it waits longer.
  const BUTTON_END_STABLE_MS = 500;
  const INACTIVITY_END_MS = 5000;
  const BATCH_MS = 40;          // batch postMessage calls to content script
  const TOOL_DEDUP_TTL_MS = 120000;

  // v2.6.6-fix: remember which thinking containers we already expanded so we
  // don't click their header on every poll cycle.
  const _expandedThinkingContainers = new WeakSet();

  // ── Provider-specific selector chains. Order matters: first match wins. ──
  function getSelectors() {
    const host = window.location.hostname;
    if (host.includes('deepseek.com') || host.includes('deepseek.ai')) {
      return {
        chatContainer: '.ds-chat, .chat-content, [class*="chat-content"], [class*="conversation-list"], main',
        assistantSegment: [
          '.ds-message[data-message-role="assistant"]',
          '.message.assistant-message',
          '[data-message-role="assistant"]',
          '.ds-message'
        ].join(','),
        thinkingContainer: [
          '.ds-thinking',
          '[class*="thinking"]',
          '[class*="reasoning"]'
        ].join(','),
        thinkingText: [
          '.ds-markdown',
          '.markdown',
          '.message-content'
        ].join(','),
        responseContainer: [
          '.ds-markdown',
          '.message-content',
          '.ds-message .markdown'
        ].join(','),
        codeBlock: [
          'pre code',
          '.ds-markdown pre code',
          '.ds-message pre code'
        ].join(','),
        toolContainer: [
          '[class*="toolcall"]'
        ].join(','),
        sendButton: [
          'div[role="button"].ds-button--primary',
          'div[role="button"][aria-label*="send" i]',
          'button[type="submit"]'
        ].join(','),
        stopButton: [
          'div[role="button"] svg[class*="stop"]',
          'div[role="button"][aria-label*="stop" i]',
          '[class*="stop"]'
        ].join(',')
      };
    }

    // Default: Kimi Web (covers 2026-07 refresh and legacy variants)
    return {
      chatContainer: [
        '.chat-content',
        '.chat-main',
        '[class*="chat-content"]',
        '[class*="conversation-list"]',
        '[class*="chat-list"]',
        'main'
      ].join(','),
      assistantSegment: [
        '.chat-content-item.chat-content-item-assistant',
        '.segment.segment-assistant',
        '[data-message-role="assistant"]',
        '[data-testid="segment-assistant"]',
        '.assistant-segment',
        '.message.assistant'
      ].join(','),
      // Source of truth: the dedicated thinking container rendered by Kimi.
      // v11.8: expanded to cover current and future class variants.
      thinkingContainer: [
        '.toolcall-container.thinking-container',
        '.thinking-container',
        '[class*="thinking-container"]',
        '[class*="think-container"]',
        '[class*="reasoning-container"]',
        '[class*="thought-container"]',
        '[class*="toolcall-container"][class*="thinking"]'
      ].join(','),
      // Where to read the actual reasoning text from inside the container.
      // v11.8: cover more markdown/text container variants.
      thinkingText: [
        '.toolcall-container.thinking-container .markdown-container',
        '.toolcall-container.thinking-container .markdown',
        '.thinking-container .markdown-container',
        '.thinking-container .markdown',
        '[class*="thinking-container"] .markdown-container',
        '[class*="thinking-container"] .markdown',
        '[class*="think-container"] .markdown-container',
        '[class*="reasoning-container"] .markdown-container',
        '[class*="thought-container"] .markdown-container'
      ].join(','),
      // Response comes from markdown/text containers that are NOT inside the thinking container.
      // v11.8: removed .segment-content-box and .segment-text — they are ancestors of the
      // thinking container and leak reasoning text into the response when the thinking
      // container is not found in time. Prefer leaf paragraphs/markdown containers.
      responseContainer: [
        '.markdown-container .markdown',
        '.markdown-container',
        '.message-content',
        '[class*="message-content"]',
        '.segment-assistant .paragraph',
        '.segment-assistant p',
        '[class*="segment-content"] .paragraph',
        '[class*="segment-content"] p',
        '.block-item .paragraph',
        '.block-item p'
      ].join(','),
      codeBlock: [
        'pre code',
        '.segment-code',
        '.markdown-container pre code',
        '.markdown pre code',
        '[class*="code-block"] code'
      ].join(','),
      toolContainer: [
        '[class*="toolcall"]',
        '.toolcall-ipython',
        '.toolcall-web_search',
        '.toolcall-web_open_url',
        '.toolcall-search_image',
        '.toolcall-browser',
        '.toolcall-computer'
      ].join(','),
      sendButton: [
        '.send-button-container',
        'button[type="submit"]',
        '.send-btn',
        '[data-testid="send-button"]',
        '[aria-label*="send" i]'
      ].join(','),
      stopButton: [
        '.stop-button-container',
        'button.stop-btn',
        '.stop-generation',
        '[data-testid="stop-button"]',
        '[aria-label*="stop" i]',
        '[class*="stop"]'
      ].join(',')
    };
  }

  const SELECTORS = getSelectors();

  // ── Extension presence markers ──
  window.__lunaObserverVersion = VERSION;
  try {
    if (window.__lunaDomObserver && typeof window.__lunaDomObserver.teardown === 'function') {
      window.__lunaDomObserver.teardown();
    }
    // If the legacy Playwright fallback was already injected, tear it down.
    if (window.__lunaUltraLightObserver && typeof window.__lunaUltraLightObserver.docObserver !== 'undefined') {
      window.__lunaUltraLightObserver.docObserver.disconnect();
      window.__lunaUltraLightObserver = undefined;
    }
    if (window.__lunaEventQueue && typeof window.__lunaEventQueue === 'object') {
      window.__lunaEventQueue = undefined;
    }
    if (window.__lunaDomObserver && window.__lunaDomObserver.observer) {
      window.__lunaDomObserver.observer.disconnect();
    }
  } catch (e) {}

  // ── Event batcher ──
  let _eventQueue = [];
  let _flushTimer = null;

  function flushEvents() {
    if (_eventQueue.length === 0) return;
    const batch = _eventQueue.slice();
    _eventQueue = [];
    try {
      window.postMessage({
        source: 'luna-injected',
        version: VERSION,
        type: 'luna_event_batch',
        events: batch,
        timestamp: Date.now(),
        url: window.location.href
      }, '*');
    } catch (e) {}
  }

  function queueEvent(type, data) {
    _eventQueue.push({ type, data, timestamp: Date.now(), url: window.location.href });
    if (_flushTimer) clearTimeout(_flushTimer);
    _flushTimer = setTimeout(flushEvents, BATCH_MS);
  }

  // ── Utilities ──
  function safeQuery(selector, root) {
    try { return (root || document).querySelectorAll(selector); }
    catch (e) { return []; }
  }

  function safeText(el) {
    try { return (el.textContent || '').trim(); }
    catch (e) { return ''; }
  }

  function isVisible(el) {
    try {
      if (!el) return false;
      return !!(el.offsetParent !== null && window.getComputedStyle(el).display !== 'none');
    } catch (e) { return false; }
  }

  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return h;
  }

  function className(el) {
    try { return (el.className || '').toLowerCase(); }
    catch (e) { return ''; }
  }

  function isInsideThinkingContainer(el, thinkingContainer) {
    if (!thinkingContainer || !el) return false;
    return el === thinkingContainer || thinkingContainer.contains(el);
  }

  function isCopyButton(el) {
    try {
      const text = (el.textContent || '').toLowerCase();
      const cls = className(el);
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      return text.includes('copy') || text.includes('复制') || text.includes('複製') || text.includes('copiar') ||
             cls.includes('copy') || aria.includes('copy');
    } catch (e) { return false; }
  }

  function isCodeElement(el) {
    try {
      const tag = (el.tagName || '').toLowerCase();
      const cls = className(el);
      return tag === 'pre' || tag === 'code' || cls.includes('code') || cls.includes('language-');
    } catch (e) { return false; }
  }

  // ── Assistant / thinking / response extraction ──
  function findChatContainer() {
    for (const node of safeQuery(SELECTORS.chatContainer)) {
      if (isVisible(node)) return node;
    }
    return document.body;
  }

  function findLastAssistant() {
    const segs = safeQuery(SELECTORS.assistantSegment);
    if (segs.length > 0) return segs[segs.length - 1];
    const fallbacks = document.querySelectorAll('[class*="assistant"], [class*="bot-message"]');
    return fallbacks.length ? fallbacks[fallbacks.length - 1] : null;
  }

  function findThinkingContainer(assistant) {
    if (!assistant) return null;
    // v11.8: prefer the most specific match first, then fall back to any thinking-ish container.
    const candidates = safeQuery(SELECTORS.thinkingContainer, assistant);
    for (const node of candidates) {
      const cls = className(node);
      if (cls.includes('thinking-container')) return node;
    }
    for (const node of candidates) {
      const cls = className(node);
      if (cls.includes('thinking') || cls.includes('think-container') || cls.includes('reasoning') || cls.includes('thought')) return node;
    }
    return null;
  }

  // v2.6.6-fix: Kimi's new UI renders the thinking container collapsed by default
  // once the response starts, so textContent only returns a short preview.
  // Clicking the header/title expands the full reasoning DOM so we can mirror it.
  function expandThinkingContainer(container) {
    if (!container || _expandedThinkingContainers.has(container)) return;
    try {
      const titleSelectors = [
        '.toolcall-title-container',
        '.toolcall-title-name',
        '[class*="toolcall-title"]',
        '[class*="thinking-title"]',
        '[class*="reasoning-title"]',
        '[class*="thought-title"]',
        '.thinking-header',
        '.reasoning-header'
      ];
      let title = null;
      for (const sel of titleSelectors) {
        title = container.querySelector(sel);
        if (title && isVisible(title)) break;
      }
      // Fallback: the first visible child that looks like a clickable header.
      if (!title) {
        for (const child of container.children) {
          if (isVisible(child) && (child.tagName === 'BUTTON' || child.getAttribute('role') === 'button' || className(child).includes('title') || className(child).includes('header'))) {
            title = child;
            break;
          }
        }
      }
      if (title) {
        title.click();
        title.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        _expandedThinkingContainers.add(container);
        console.log('[LunaExt DEBUG] expanded thinking container');
      }
    } catch (e) {}
  }

  // Extract ALL reasoning text from the container, not just the first markdown leaf.
  function extractThinking(thinkingContainer) {
    if (!thinkingContainer) return '';
    try {
      // Try the explicit markdown container first, but collect ALL matching containers
      // in case Kimi splits the thinking into multiple blocks.
      let combined = '';
      // v2.6.6-fix: use textContent (not innerText) so we capture the FULL reasoning
      // even when Kimi collapses the thinking container after the response starts.
      // innerText respects visibility and only returns the collapsed preview; textContent
      // returns every text node in the DOM subtree. We strip the header/chrome afterwards.
      const raw = thinkingContainer.textContent || '';
      if (!raw) return '';
      // Remove copy-button text and other UI chrome that textContent may include.
      const noChrome = raw
        .replace(/\b(Copy|复制|複製|Copiar)\b/gi, '')
        .replace(/^\s*\b(Thinking|Think|Pensando|Analisando|Analisar|Raciocínio|Raciocinando|Concluído|Concluindo|Raciocínio concluído|Reasoning|Processando|Searching|Buscando)\b\s*[.:]?\s*/i, '')
        .replace(/\s*JSON\s*$/i, '')
        .trim();
      return noChrome;

      // LEGACY: explicit markdown container collection kept for reference.
      const explicitNodes = thinkingContainer.querySelectorAll(SELECTORS.thinkingText);
      if (explicitNodes.length > 0) {
        // v2.6.2-fix: selectors may match nested containers (e.g. .markdown-container
        // and the .markdown inside it). Keep only the deepest nodes to avoid duplicating
        // the same text for every ancestor/descendant pair.
        const keep = [];
        for (const node of explicitNodes) {
          const hasDescendantSelected = Array.from(explicitNodes).some(other =>
            other !== node && node.contains(other)
          );
          if (!hasDescendantSelected) keep.push(node);
        }
        for (const node of keep) {
          const t = collectTextIgnoringChrome(node);
          if (t) combined += t + '\n\n';
        }
        if (combined) return stripThinkingHeader(combined);
      }

      // Fallback: walk the container ignoring non-reasoning UI chrome.
      return stripThinkingHeader(collectTextIgnoringChrome(thinkingContainer));
    } catch (e) { return ''; }
  }

  // Collect text from an element, skipping headers, copy buttons and code blocks.
  function collectTextIgnoringChrome(root) {
    let text = '';
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent || '';
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (isCopyButton(node)) return;
      if (isCodeElement(node)) {
        // Still include the text of JSON code blocks if they are inside the thinking,
        // because the model may be emitting the JSON wrapper there. But skip copy buttons.
        const cls = className(node);
        const isJsonBlock = cls.includes('json') || /["']tool["']|"response"/.test(node.textContent || '');
        if (!isJsonBlock) return;
      }
      // Skip a standalone header element (covers Portuguese UI variants too).
      // Only treat it as a header if the node has no element children; otherwise
      // returning here would discard the entire reasoning block when the container
      // itself starts with "Analisando...".
      const nodeText = safeText(node);
      const hasElementChildren = Array.from(node.childNodes).some(n => n.nodeType === Node.ELEMENT_NODE);
      if (!hasElementChildren && nodeText && /^\s*(Think|Thinking|Pensando|Analisando|Analisar|Raciocínio|Raciocinando|Concluído|Concluindo|Raciocínio concluído|Reasoning|Processando|Searching|Buscando)\b/i.test(nodeText)) {
        return;
      }
      for (const child of node.childNodes) walk(child);
    };
    walk(root);
    return text;
  }

  function stripThinkingHeader(text) {
    return text
      .replace(/^\s*\b(Thinking|Think|Pensando|Analisando|Analisar|Raciocínio|Raciocinando|Concluído|Concluindo|Raciocínio concluído|Reasoning|Processando|Searching|Buscando)\b\s*[.:]?\s*/i, '')
      .replace(/\s*JSON\s*Copy\s*$/i, '')
      .trim();
  }

  // v2.6.6-fix: collect text from an element but exclude any descendant that lives
  // inside the thinking container. This lets us keep response text from a parent
  // that also contains the thinking container, instead of throwing it all away.
  function collectTextOutsideThinking(root, thinkingContainer) {
    if (!root) return '';
    let text = '';
    const walk = (node) => {
      if (thinkingContainer && isInsideThinkingContainer(node, thinkingContainer)) return;
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent || '';
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (isCopyButton(node)) return;
      for (const child of node.childNodes) walk(child);
    };
    walk(root);
    return text.trim();
  }

  function extractResponse(assistant, thinkingContainer) {
    try {
      let text = '';
      const seen = new Set();
      for (const node of safeQuery(SELECTORS.responseContainer, assistant)) {
        if (isInsideThinkingContainer(node, thinkingContainer)) continue;
        if (node.closest && node.closest(SELECTORS.thinkingContainer)) continue;
        if (node.closest && node.closest(SELECTORS.toolContainer)) continue;

        // v2.6.6-fix: if the candidate is an ancestor of the thinking container,
        // don't discard it wholesale — extract only the text outside the thinking.
        let t = '';
        if (thinkingContainer && node !== thinkingContainer && node.contains && node.contains(thinkingContainer)) {
          t = collectTextOutsideThinking(node, thinkingContainer);
        } else {
          t = safeText(node);
        }
        if (!t || seen.has(t)) continue;
        seen.add(t);
        text += t + '\n\n';
      }
      return text.trim();
    } catch (e) { return ''; }
  }

  // v2.6.3: The boundary rule is absolute — everything inside the thinking
  // container is reasoning; everything outside is response/tool. We no longer
  // treat a "JSON Copy" button or a JSON code block inside the thinking container
  // as a signal that reasoning ended; those elements are still part of Kimi's
  // reasoning UI and must stay in the thinking bubble.

  // ── JSON block detection (response/tool blocks outside the thinking container) ──
  function extractFirstJsonObject(text) {
    if (!text || text.length < 2) return null;
    let i = 0;
    while (i < text.length) {
      if (text[i] !== '{') { i++; continue; }
      const start = i;
      let depth = 1;
      let inString = false;
      let escape = false;
      i++;
      while (i < text.length && depth > 0) {
        const c = text[i];
        if (escape) {
          escape = false;
        } else if (c === '\\') {
          escape = true;
        } else if (c === '"') {
          if (inString) {
            let j = i + 1;
            while (j < text.length && /\s/.test(text[j])) j++;
            if (j >= text.length || text[j] === ',' || text[j] === ':' || text[j] === '}' || text[j] === ']') {
              inString = false;
            }
          } else {
            inString = true;
          }
        } else if (!inString) {
          if (c === '{') depth++;
          else if (c === '}') depth--;
        }
        i++;
      }
      if (depth === 0) return text.slice(start, i);
    }
    return null;
  }

  // v2.7.0: minimal JSON repair for LLM output — closes truncated strings and
  // open structures, escapes literal newlines inside strings, tolerates
  // unescaped internal quotes, strips trailing commas. Ported from
  // lib/tool-json-parser.cjs (the extension has no bundler for jsonrepair).
  // ONLY applied after streaming ends — a mid-stream block is legitimately
  // incomplete and must not be auto-closed into a premature tool call.
  function miniJsonRepair(text) {
    let out = '';
    let inString = false;
    let escape = false;
    const stack = [];
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (escape) { out += c; escape = false; continue; }
      if (c === '\\') { out += c; escape = true; continue; }
      if (c === '"') {
        if (inString) {
          let j = i + 1;
          while (j < text.length && /\s/.test(text[j])) j++;
          if (j >= text.length || text[j] === ',' || text[j] === ':' || text[j] === '}' || text[j] === ']') {
            inString = false; out += c; continue;
          }
          out += '\\"'; continue; // unescaped internal quote
        }
        inString = true; out += c; continue;
      }
      if (inString && (c === '\n' || c === '\r' || c === '\t')) {
        out += c === '\n' ? '\\n' : c === '\t' ? '\\t' : '\\r'; continue;
      }
      if (!inString) {
        if (c === '{' || c === '[') stack.push(c);
        else if (c === '}' || c === ']') stack.pop();
      }
      out += c;
    }
    if (inString) out += '"'; // close truncated string
    while (stack.length) out += stack.pop() === '{' ? '}' : ']'; // close open structures
    out = out.replace(/,\s*([}\]])/g, '$1'); // trailing commas
    return out;
  }

  function parseJsonBlock(text, allowRepair = false) {
    if (!text || text.length < 5) return null;
    const isJsonLike = (text.startsWith('{') && text.includes('"')) ||
                       (text.startsWith('[') && text.includes('"'));
    if (!isJsonLike) return null;
    try { return JSON.parse(text); }
    catch (e) {
      const objText = extractFirstJsonObject(text);
      if (objText) try { return JSON.parse(objText); } catch (e2) {}
      // v2.7.0: stream ended and the block never parsed — repair instead of
      // silently dropping the tool/response. Flag it so downstream can log.
      if (!allowRepair) return null;
      try {
        const repaired = JSON.parse(miniJsonRepair(objText || text));
        if (repaired && typeof repaired === 'object') repaired.__repaired = true;
        console.log('[LunaExt RESCUE] miniJsonRepair recovered a JSON block');
        return repaired;
      } catch (e3) { return null; }
    }
    return null;
  }

  function detectJsonBlocks(container, thinkingContainer, allowRepair = false) {
    const results = { actions: [], responses: [] };
    try {
      for (const block of safeQuery(SELECTORS.codeBlock, container)) {
        if (isInsideThinkingContainer(block, thinkingContainer)) continue;
        const parsed = parseJsonBlock(safeText(block), allowRepair);
        if (!parsed) continue;
        const wasRepaired = parsed.__repaired === true;
        if (wasRepaired) delete parsed.__repaired;
        if (parsed.tool !== undefined || parsed.action !== undefined) {
          results.actions.push({ tool: parsed.tool || parsed.action, params: parsed.params || parsed.arguments || {}, rescued: wasRepaired });
        } else if (parsed.response !== undefined || parsed.result !== undefined) {
          results.responses.push({ response: parsed.response || parsed.result, rescued: wasRepaired });
        }
      }
    } catch (e) {}
    return results;
  }

  // ── Button state ──
  function detectButtonState() {
    const state = { sendVisible: false, stopVisible: false };
    try {
      const sendBtn = document.querySelector(SELECTORS.sendButton);
      const stopBtn = document.querySelector(SELECTORS.stopButton);
      if (sendBtn) state.sendVisible = isVisible(sendBtn) && !sendBtn.disabled;
      if (stopBtn) state.stopVisible = isVisible(stopBtn) && !stopBtn.disabled;
    } catch (e) {}
    return state;
  }

  // ── Streaming state machine ──
  let _currentAssistant = null;
  let _lastSentThinking = '';
  let _lastSentResponse = '';
  let _thinkingStartedEmitted = false;
  let _wasStreaming = false;
  let _detectedToolKeys = new Map(); // v2.7.0-fix: key -> assistant node (per-bubble dedup)
  let _detectedResponseKeys = new Map(); // key -> assistant node
  let _lastDedupCleanup = Date.now();
  let _lastButtonState = {};
  let _lastSeenThinkingContainer = null;
  let _firstThinkingSnapshot = '';
  let _lastChangeTime = Date.now();
  let _lastChangeHash = '';
  let _streamEndEmitted = false;
  // v13.0 (F1.3): pending Stop→Send transition timestamp. The button flickers
  // during React re-renders mid-stream; stream_end (signal 'button') only fires
  // after the not-streaming state persists for BUTTON_END_STABLE_MS.
  let _pendingButtonEndAt = 0;
  // v2.6.11-fix: after a reset we prime the observer with the current DOM; while
  // primed, heartbeat forceResync must NOT re-emit the stale thinking/response
  // that is still on screen, otherwise the bridge seeds the new turn with it.
  let _resetPrimed = false;

  // ── Delimited Protocol v2.0 ──
  // Protocol uses semantic envelopes: <luna_tool_call>...</luna_tool_call> and <luna_response>...</luna_response>
  // The LLM does NOT send IDs. Luna generates toolInstanceId internally.
  // Parser must handle chunked delimiters (e.g., <luna_tool in one chunk, _call> in next).

  // Protocol constants (semantic envelope - single tag with closing)
  const TOOL_OPEN = '<luna_tool_call>';
  const TOOL_CLOSE = '</luna_tool_call>';
  const RESPONSE_OPEN = '<luna_response>';
  const RESPONSE_CLOSE = '</luna_response>';

  // Protocol State Machine
  const PROTOCOL_STATES = {
    IDLE: 'IDLE',
    DETECTING: 'DETECTING',
    TOOL_BUFFERING: 'TOOL_BUFFERING',
    TOOL_COMPLETE: 'TOOL_COMPLETE',
    RESPONSE_BUFFERING: 'RESPONSE_BUFFERING',
    RESPONSE_COMPLETE: 'RESPONSE_COMPLETE',
    VALIDATING: 'VALIDATING',
    READY: 'READY',
    UNKNOWN_OUTPUT: 'UNKNOWN_OUTPUT'
  };

  let _protocolState = PROTOCOL_STATES.IDLE;
  let _protocolBuffer = '';
  let _protocolStartTime = null;
  let _protocolToolId = null;
  let _protocolType = null; // 'tool' or 'response'
  // Track partial delimiter matches for chunked detection
  let _partialDelimiter = '';
  // Track whether a valid protocol was detected during the current turn
  let _protocolDetectedThisTurn = false;
  // FASE A: Track processed tool hashes to prevent reprocessing the same snapshot
  let _processedToolHashes = new Set();
  // FASE B: V2 Authority Gate - track when V2 has produced a valid event
  let _v2AuthorityActive = false;
  let _v2AuthorityType = null; // 'tool' or 'response'

  function resetProtocol() {
    _protocolState = PROTOCOL_STATES.IDLE;
    _protocolBuffer = '';
    _protocolStartTime = null;
    _protocolToolId = null;
    _protocolType = null;
    _partialDelimiter = '';
  }

  function resetTurnProtocolState() {
    _protocolDetectedThisTurn = false;
    _processedToolHashes.clear();
    _v2AuthorityActive = false;
    _v2AuthorityType = null;
    resetProtocol();
  }

  // FASE B: Check if V2 authority is blocking legacy
  function isV2BlockingLegacy(eventType) {
    if (!_v2AuthorityActive) return false;
    // V2 blocks legacy for the same type
    if (_v2AuthorityType === 'tool' && eventType === 'tool') return true;
    if (_v2AuthorityType === 'response' && eventType === 'response') return true;
    return false;
  }

  function generateToolId() {
    return `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Check if text starts with a protocol delimiter (handles chunked delimiters)
  function findProtocolStart(text) {
    if (!text) return null;

    // Check for tool protocol
    if (text.includes(TOOL_OPEN)) return { type: 'tool', tag: TOOL_OPEN };
    // Check for response protocol
    if (text.includes(RESPONSE_OPEN)) return { type: 'response', tag: RESPONSE_OPEN };

    // Check for partial delimiter at end of text (for chunked detection)
    const toolPartial = findPartialMatch(text, TOOL_OPEN);
    if (toolPartial) return { type: 'tool_partial', tag: toolPartial };

    const responsePartial = findPartialMatch(text, RESPONSE_OPEN);
    if (responsePartial) return { type: 'response_partial', tag: responsePartial };

    return null;
  }

  // Find if text ends with a partial match of the delimiter
  function findPartialMatch(text, delimiter) {
    // Check if the end of text matches the beginning of delimiter
    for (let i = Math.min(text.length, delimiter.length - 1); i > 0; i--) {
      if (text.endsWith(delimiter.substring(0, i))) {
        return delimiter.substring(0, i);
      }
    }
    return null;
  }

  // Find protocol close tag in text
  function findProtocolClose(text, closeTag) {
    return text.indexOf(closeTag);
  }

  function getToolKey(tool, params) {
    try {
      const paramsStr = JSON.stringify(params);
      if (paramsStr.length > 200) return `${tool}::${hashString(paramsStr)}`;
      return `${tool}::${paramsStr}`;
    } catch (e) { return `${tool}::${Date.now()}`; }
  }

  function cleanupDedup() {
    if (Date.now() - _lastDedupCleanup < TOOL_DEDUP_TTL_MS) return;
    // v2.7.0-fix: node-scoped pruning — keep entries for the current bubble so
    // within-bubble re-scans stay deduped; drop entries from older bubbles.
    if (_detectedToolKeys.size > 300) {
      for (const [k, node] of _detectedToolKeys) if (node !== _currentAssistant) _detectedToolKeys.delete(k);
    }
    if (_detectedResponseKeys.size > 300) {
      for (const [k, node] of _detectedResponseKeys) if (node !== _currentAssistant) _detectedResponseKeys.delete(k);
    }
    // Hard cap: if a single bubble legitimately produced >300 keys, keep the newest.
    if (_detectedToolKeys.size > 300) _detectedToolKeys = new Map(Array.from(_detectedToolKeys).slice(-200));
    if (_detectedResponseKeys.size > 300) _detectedResponseKeys = new Map(Array.from(_detectedResponseKeys).slice(-200));
    _lastDedupCleanup = Date.now();
  }

  // v11.8-fix: fallback heuristic — when Kimi's DOM does not expose a dedicated
  // thinking container, detect the reasoning prefix in the response text and split it out.
  // Returns { thinking, response }.
  const THINK_STARTERS = /^(O usu[áa]rio|Vou |Agora |Preciso |Primeiro |Vamos |Ent[aã]o |Deixa |Hmm |Ok |Okay |Let me |I need |I'll |First |Now |So |The user |Pensando|Analisando|Raciocinando|Reasoning|Thinking|Processando|Buscando|Searching|Concluindo|Conclu[íi]do)/i;
  function splitThinkingAndResponse(rawText, hasThinkingContainer) {
    if (!rawText || hasThinkingContainer) return { thinking: '', response: rawText || '' };
    // If there is a JSON/code block and text before it looks like reasoning, split.
    const codeIdx = rawText.indexOf('```');
    const jsonIdx = rawText.search(/\{\s*"/);
    const firstRealIdx = codeIdx >= 0 && jsonIdx >= 0 ? Math.min(codeIdx, jsonIdx)
      : codeIdx >= 0 ? codeIdx
      : jsonIdx >= 0 ? jsonIdx
      : -1;
    if (firstRealIdx > 10) {
      const before = rawText.slice(0, firstRealIdx).trim();
      const after = rawText.slice(firstRealIdx).trim();
      if (THINK_STARTERS.test(before) || before.length < 500) {
        return { thinking: before, response: after };
      }
    }
    // Entire text is reasoning.
    if (!rawText.includes('```') && !rawText.includes('{') && (THINK_STARTERS.test(rawText) || rawText.length < 300)) {
      return { thinking: rawText, response: '' };
    }
    return { thinking: '', response: rawText };
  }

  function resetAssistantState() {
    _lastSentThinking = '';
    _lastSentResponse = '';
    _thinkingStartedEmitted = false;
    _streamEndEmitted = false;
    _pendingButtonEndAt = 0;
    _lastSeenThinkingContainer = null;
    _firstThinkingSnapshot = '';
    _lastChangeTime = Date.now();
    _lastChangeHash = '';
  }

  // v13.0 (F1.5'): emit the naturally-complete tool blocks of a FINISHED bubble.
  // Called once stream_end is confirmed, when the bubble changes (node re-mount
  // or new turn), and on the polls right after. Per-bubble dedup (v2.7.0) makes
  // repeat calls harmless; a re-issue in a NEW bubble is still legitimate.
  function emitFinalToolCalls(targetAssistant, preScannedBlocks) {
    if (!targetAssistant) return;
    // FASE B: V2 Authority Gate - skip legacy tool detection if V2 is active
    if (isV2BlockingLegacy('tool')) {
      console.log(`[V2_AUTHORITY][BLOCKED] time=${Date.now()} reason=emitFinalToolCalls_blocked_by_v2`);
      return;
    }
    try {
      const blocks = preScannedBlocks || detectJsonBlocks(targetAssistant, findThinkingContainer(targetAssistant), /* allowRepair */ false);
      for (const action of blocks.actions) {
        const key = getToolKey(action.tool, action.params);
        if (_detectedToolKeys.get(key) !== targetAssistant) {
          _detectedToolKeys.set(key, targetAssistant);
          queueEvent('tool_call_detected', { tool: action.tool, params: action.params, rescued: false });
          queueEvent('json_block_added', { actions: [{ tool: action.tool, params: action.params, rescued: false }], responses: [] });
        }
      }
    } catch (e) {}
  }

  function emitStreamState(thinking, response, isStreaming) {
    queueEvent('stream_state', {
      thinking: thinking || '',
      response: response || '',
      isStreaming: isStreaming ?? true,
      isComplete: false
    });
  }

  // v2.6.1-fix: source-of-truth full thinking replacement. The Kimi page is the
  // source of truth; sending the complete reasoning text every cycle lets the
  // frontend replace the bubble content exactly, instead of relying on fragile
  // delta accumulation when the DOM alternates thinking/response states.
  function emitThinkingUpdate(thinking) {
    if (!thinking) return;
    queueEvent('thinking_update', {
      fullThinking: thinking,
      timestamp: Date.now(),
      channel: 'THINKING'
    });
  }

  function detectAndEmit(forceResync = false) {
    try {
      const assistant = findLastAssistant();
      const btnState = detectButtonState();
      const nowStreaming = btnState.stopVisible;

      // v2.6.11-fix: after a reset we ignore forceResync until a new assistant or
      // thinking container actually appears. Otherwise the heartbeat re-emits the
      // stale thinking/response still on screen and seeds the new turn with it.
      const effectiveForceResync = forceResync && !_resetPrimed;

      // Reset state when the assistant bubble changes (new turn)
      if (assistant !== _currentAssistant) {
        const oldClass = _currentAssistant ? className(_currentAssistant) : 'null';
        const newClass = assistant ? className(assistant) : 'null';
        console.log(`[LunaExt DEBUG] assistant changed: ${oldClass} -> ${newClass}`);
        // v13.0 (F1.5'): the previous bubble is definitively finished — flush
        // any complete tool blocks never emitted (e.g. the node re-mounted
        // right after stream_end, before the post-stream_end poll ran).
        if (_currentAssistant) emitFinalToolCalls(_currentAssistant);
        _currentAssistant = assistant;
        resetAssistantState();
        resetTurnProtocolState(); // Reset protocol state for new turn
        _resetPrimed = false;
      }

      if (!assistant) return;

      const thinkingContainer = findThinkingContainer(assistant);

      // v11.8-fix: if a brand-new thinking container appears inside the same assistant
      // bubble (e.g. before a second/third tool), treat it as a fresh reasoning step.
      if (thinkingContainer && thinkingContainer !== _lastSeenThinkingContainer) {
        console.log(`[LunaExt DEBUG] new thinking container: ${className(thinkingContainer)}`);
        _lastSeenThinkingContainer = thinkingContainer;
        // v2.6.6-fix: expand the container immediately so textContent reads the full
        // reasoning instead of the collapsed preview.
        expandThinkingContainer(thinkingContainer);
        _firstThinkingSnapshot = extractThinking(thinkingContainer);
        console.log(`[LunaExt DEBUG] first thinking snapshot length: ${_firstThinkingSnapshot.length}`);
        _thinkingStartedEmitted = false;
        _lastSentThinking = '';
        _resetPrimed = false;
      }

      // v2.6.3: Absolute boundary rule — everything inside the thinking container is
      // reasoning; everything outside is response/tool. We never stop extracting
      // thinking just because a JSON Copy button or code block appears inside it.
      let thinking = extractThinking(thinkingContainer);
      let response = extractResponse(assistant, thinkingContainer);

      // v11.8-fix: if no dedicated thinking container was found, use heuristic fallback
      // to avoid reasoning text leaking into the response.
      if (!thinkingContainer && response) {
        const split = splitThinkingAndResponse(response, false);
        if (split.thinking && !thinking) {
          thinking = split.thinking;
          response = split.response;
        }
      }

      if (thinking || response) {
        console.log(`[LunaExt DEBUG] extracted thinking=${thinking.length} response=${response.length} forceResync=${forceResync} resetPrimed=${_resetPrimed}`);
      }

      // ── thinking lifecycle ──
      if (thinking && !_thinkingStartedEmitted) {
        const snapshot = _firstThinkingSnapshot || thinking;
        console.log(`[PROTOCOL][CHANNEL] time=${Date.now()} channel=THINKING len=${snapshot.length}`);
        console.log(`[LunaExt DEBUG] emitting thinking_start len=${snapshot.length}`);
        queueEvent('thinking_start', { thinking: snapshot, channel: 'THINKING' });
        _thinkingStartedEmitted = true;
        // Emit a stream_state immediately with the full snapshot so the bridge/frontend
        // initialize the bubble with everything we have, not just future deltas.
        // v2.6.8-fix: keep the last known response so the bridge cursor doesn't see
        // response oscillate between 0 and N on every thinking update.
        emitStreamState(snapshot, _lastSentResponse, true);
        // v2.6.1-fix: also emit a source-of-truth full replacement for the thinking bubble.
        emitThinkingUpdate(snapshot);
        _lastSentThinking = snapshot;
      }

      // v11.8-fix: NEVER freeze thinking. The thinking container may collapse or
      // Kimi may continue reasoning after response text starts. We keep the largest
      // reasoning text we've ever seen so the Luna bubble only grows / updates,
      // never shrinks or gets truncated.
      if (thinking && (effectiveForceResync || (thinking.length >= _lastSentThinking.length && thinking !== _lastSentThinking))) {
        console.log(`[PROTOCOL][CHANNEL] time=${Date.now()} channel=THINKING len=${thinking.length}`);
        console.log(`[LunaExt DEBUG] emitting thinking_update len=${thinking.length} (last=${_lastSentThinking.length})`);
        _lastSentThinking = thinking;
        // v2.6.8-fix: preserve last known response to stop response=0 / response=N oscillation.
        emitStreamState(thinking, _lastSentResponse, true);
        // v2.6.1-fix: source-of-truth full replacement so the frontend always mirrors Kimi.
        emitThinkingUpdate(thinking);
      }

      // ── response ──
      // v14.0: CRITICAL FIX - Check for protocol delimiters BEFORE emitting response
      // If the response contains <luna_tool_call> or <luna_response>, it must be
      // processed by the protocol parser FIRST, not emitted as a regular response.
      // Also check for PARTIAL delimiters to handle chunked streaming.
      // Also check for CLOSE tags to handle cases where response contains closing delimiter.
      
      // FIRST: Check if we have a pending partial delimiter from previous chunk
      // This must happen BEFORE the emission decision
      const hasPendingPartial = _partialDelimiter && _partialDelimiter.length > 0;
      
      const hasProtocolDelimiter = response && (
        response.includes(TOOL_OPEN) ||
        response.includes(TOOL_CLOSE) ||
        response.includes(RESPONSE_OPEN) ||
        response.includes(RESPONSE_CLOSE) ||
        _protocolState !== PROTOCOL_STATES.IDLE ||
        hasPendingPartial  // NEW: If we have a pending partial, treat as protocol
      );

      // Check if response ends with a partial delimiter (e.g., "<luna_" or "<luna_tool_call")
      // This prevents emitting partial delimiters as response_delta during streaming
      const toolPartial = response ? findPartialMatch(response, TOOL_OPEN) : null;
      const responsePartial = response ? findPartialMatch(response, RESPONSE_OPEN) : null;
      const hasPartialDelimiter = response && !hasProtocolDelimiter && (
        toolPartial !== null ||
        responsePartial !== null
      );

      // DIAGNOSTIC LOGS - Phase A: Partial delimiter investigation
      if (response) {
        console.log(`[PARTIAL_PROTOCOL] time=${Date.now()} channel=OUTPUT text="${response.substring(0, 100)}" hasPendingPartial=${hasPendingPartial} hasPartialDelimiter=${hasPartialDelimiter} toolPartial="${toolPartial}" responsePartial="${responsePartial}" parserState=${_protocolState} partialBuffer="${_partialDelimiter}"`);
      }

      // Only emit response_delta if:
      // 1. No full protocol delimiter present
      // 2. No partial delimiter at end of text
      // 3. No pending partial from previous chunk
      // 4. Not currently in a protocol state
      const shouldEmitResponse = response && !hasProtocolDelimiter && !hasPartialDelimiter && (effectiveForceResync || response !== _lastSentResponse);
      
      // DIAGNOSTIC LOG - Phase A: Response delta decision
      if (response) {
        console.log(`[RESPONSE_DELTA_DECISION] time=${Date.now()} emit=${shouldEmitResponse} reason=${hasProtocolDelimiter ? 'HAS_PROTOCOL_DELIMITER' : hasPartialDelimiter ? 'HAS_PARTIAL_DELIMITER' : hasPendingPartial ? 'HAS_PENDING_PARTIAL' : !shouldEmitResponse ? 'NO_CHANGE_OR_FILTERED' : 'EMITTING'}`);
      }

      if (shouldEmitResponse) {
        console.log(`[PROTOCOL][CHANNEL] time=${Date.now()} channel=OUTPUT len=${response.length}`);
        console.log(`[LunaExt DEBUG] emitting response_update len=${response.length}`);
        _lastSentResponse = response;
        emitStreamState(_lastSentThinking, response, true);
      }

      // ── Delimited Protocol v2.0 ──
      // Detect tools and responses using semantic envelopes:
      // <luna_tool_call>...</luna_tool_call> and <luna_response>...</luna_response>
      // CRITICAL: Only process OUTPUT channel content. THINKING channel never triggers protocol.
      // Parser handles chunked delimiters and waits for turn end before declaring UNKNOWN.
      if (response) {
        // RAW OUTPUT: Log the exact content received by the parser
        const hasToolDelimiter = response.includes(TOOL_OPEN);
        const hasResponseDelimiter = response.includes(RESPONSE_OPEN);
        const rawHash = hashString(response);
        console.log(`[RAW_OUTPUT] time=${Date.now()} channel=OUTPUT len=${response.length} hash=${rawHash} preview="${response.substring(0, 200)}"`);
        console.log(`[CLASSIFY] time=${Date.now()} channel=OUTPUT hasTool=${hasToolDelimiter} hasResponse=${hasResponseDelimiter} startsWithTool=${response.startsWith(TOOL_OPEN)} startsWithResponse=${response.startsWith(RESPONSE_OPEN)} parserState=${_protocolState}`);
        // Handle partial delimiter from previous chunk
        if (_partialDelimiter && _protocolState === PROTOCOL_STATES.IDLE) {
          // Check if this chunk completes the delimiter
          const combined = _partialDelimiter + response;
          const protocolStart = findProtocolStart(combined);
          if (protocolStart && !protocolStart.type.includes('partial')) {
            // Delimiter completed - start buffering
            _protocolState = protocolStart.type === 'tool' ? PROTOCOL_STATES.TOOL_BUFFERING : PROTOCOL_STATES.RESPONSE_BUFFERING;
            _protocolType = protocolStart.type;
            _protocolStartTime = Date.now();
            _protocolToolId = _protocolType === 'tool' ? generateToolId() : null;
            _protocolBuffer = '';
            _partialDelimiter = '';
            console.log(`[PROTOCOL][${_protocolType.toUpperCase()}_START] time=${_protocolStartTime} toolId=${_protocolToolId}`);
            queueEvent(`luna_${_protocolType}_start`, { toolId: _protocolToolId, timestamp: _protocolStartTime });
            // Process remaining content after delimiter
            response = combined.substring(protocolStart.tag.length);
          } else if (protocolStart && protocolStart.type.includes('partial')) {
            // Still partial - accumulate
            _partialDelimiter = combined;
            return;
          } else {
            // Not a protocol start - emit as unknown and reset
            _partialDelimiter = '';
          }
        }

        // Look for protocol start in current response
        if (_protocolState === PROTOCOL_STATES.IDLE) {
          const protocolStart = findProtocolStart(response);
          if (protocolStart) {
            if (protocolStart.type.includes('partial')) {
              // Partial delimiter at end - save for next chunk
              _partialDelimiter = protocolStart.tag;
              return;
            }
            // Full delimiter found - start buffering
            _protocolState = protocolStart.type === 'tool' ? PROTOCOL_STATES.TOOL_BUFFERING : PROTOCOL_STATES.RESPONSE_BUFFERING;
            _protocolType = protocolStart.type;
            _protocolStartTime = Date.now();
            _protocolToolId = _protocolType === 'tool' ? generateToolId() : null;
            _protocolBuffer = '';
            console.log(`[PROTOCOL][${_protocolType.toUpperCase()}_START] time=${_protocolStartTime} toolId=${_protocolToolId}`);
            queueEvent(`luna_${_protocolType}_start`, { toolId: _protocolToolId, timestamp: _protocolStartTime });
            // Remove the opening tag from response
            response = response.substring(protocolStart.tag.length);
          }
        }

        // Buffer content if we're in a protocol
        if (_protocolState === PROTOCOL_STATES.TOOL_BUFFERING || _protocolState === PROTOCOL_STATES.RESPONSE_BUFFERING) {
          const closeTag = _protocolType === 'tool' ? TOOL_CLOSE : RESPONSE_CLOSE;
          const closeIdx = findProtocolClose(response, closeTag);

          if (closeIdx !== -1) {
            // Close tag found - complete the protocol
            const content = response.substring(0, closeIdx);
            _protocolBuffer += content;
            _protocolState = _protocolType === 'tool' ? PROTOCOL_STATES.TOOL_COMPLETE : PROTOCOL_STATES.RESPONSE_COMPLETE;

            console.log(`[PROTOCOL][${_protocolType.toUpperCase()}_COMPLETE] time=${Date.now()} toolId=${_protocolToolId} bufferSize=${_protocolBuffer.length}`);
            queueEvent(`luna_${_protocolType}_complete`, { toolId: _protocolToolId, timestamp: Date.now() });

            // Parse and validate
            _protocolState = PROTOCOL_STATES.VALIDATING;
            console.log(`[PROTOCOL][PARSE] time=${Date.now()} toolId=${_protocolToolId}`);

            if (_protocolType === 'tool') {
              try {
                // v14.0: Use miniJsonRepair before JSON.parse to handle malformed JSON
                // (e.g., Windows paths with unescaped backslashes from LLM output)
                let toolCall;
                try {
                  toolCall = JSON.parse(_protocolBuffer);
                } catch (parseErr) {
                  // Try miniJsonRepair for malformed JSON
                  console.log(`[PROTOCOL][REPAIR] time=${Date.now()} toolId=${_protocolToolId} error="${parseErr.message}"`);
                  const repaired = miniJsonRepair(_protocolBuffer);
                  toolCall = JSON.parse(repaired);
                  console.log(`[PROTOCOL][REPAIRED] time=${Date.now()} toolId=${_protocolToolId}`);
                }
                console.log(`[PROTOCOL][VALIDATE] time=${Date.now()} toolId=${_protocolToolId} tool=${toolCall.name}`);

                // Validate required fields (name and arguments)
                if (toolCall.name && toolCall.arguments) {
                  // FASE A: Check if this tool has already been processed this turn
                  const toolHash = hashString(_protocolBuffer);
                  if (_processedToolHashes.has(toolHash)) {
                    console.log(`[PROTOCOL][DEDUP] time=${Date.now()} tool=${toolCall.name} hash=${toolHash} reason=already_processed`);
                    resetProtocol();
                    return;
                  }
                  // Mark this tool as processed
                  _processedToolHashes.add(toolHash);
                  
                  _protocolState = PROTOCOL_STATES.READY;
                  console.log(`[PROTOCOL][READY] time=${Date.now()} toolId=${_protocolToolId} tool=${toolCall.name} hash=${toolHash}`);

                  // Emit tool_call_detected event with protocol metadata
                  queueEvent('luna_tool_call_complete', {
                    toolCall: { name: toolCall.name, arguments: toolCall.arguments },
                    rescued: false,
                    protocol: 'delimited',
                    toolId: _protocolToolId,
                    channel: 'OUTPUT'
                  });

                  // Also emit as tool_call_detected for backward compatibility
                  queueEvent('tool_call_detected', {
                    tool: toolCall.name,
                    params: toolCall.arguments,
                    rescued: false,
                    protocol: 'delimited',
                    toolId: _protocolToolId,
                    channel: 'OUTPUT'
                  });

                  // Mark that a valid protocol was detected this turn
                  _protocolDetectedThisTurn = true;
                  
                  // FASE B: Activate V2 authority for tools
                  _v2AuthorityActive = true;
                  _v2AuthorityType = 'tool';
                  console.log(`[PROTOCOL][V2_AUTHORITY] time=${Date.now()} type=tool tool=${toolCall.name}`);

                  console.log(`[PROTOCOL][EMIT] time=${Date.now()} toolId=${_protocolToolId} tool=${toolCall.name}`);
                } else {
                  console.log(`[PROTOCOL][ERROR] time=${Date.now()} toolId=${_protocolToolId} error="missing name or arguments"`);
                  queueEvent('luna_unknown_output', { text: _protocolBuffer, error: 'missing name or arguments' });
                }
              } catch (e) {
                console.log(`[PROTOCOL][ERROR] time=${Date.now()} toolId=${_protocolToolId} error="invalid JSON: ${e.message}"`);
                queueEvent('luna_unknown_output', { text: _protocolBuffer, error: `invalid JSON: ${e.message}` });
              }
            } else {
              // Response protocol
              _protocolState = PROTOCOL_STATES.READY;
              console.log(`[PROTOCOL][RESPONSE_READY] time=${Date.now()} bufferSize=${_protocolBuffer.length}`);

              // Emit response_complete event
              queueEvent('luna_response_complete', {
                response: _protocolBuffer,
                protocol: 'delimited',
                channel: 'OUTPUT'
              });

              // Mark that a valid protocol was detected this turn
              _protocolDetectedThisTurn = true;
              
              // FASE B: Activate V2 authority for responses
              _v2AuthorityActive = true;
              _v2AuthorityType = 'response';
              console.log(`[PROTOCOL][V2_AUTHORITY] time=${Date.now()} type=response`);

              console.log(`[PROTOCOL][EMIT] time=${Date.now()} type=response`);
            }

            // Reset protocol state
            resetProtocol();
          } else {
            // Still buffering - accumulate content
            _protocolBuffer += response;
            console.log(`[PROTOCOL][BUFFERING] time=${Date.now()} toolId=${_protocolToolId} bufferSize=${_protocolBuffer.length}`);
          }
        }
      }

      // ── tools / responses (legacy path) ──
      // v13.0 (F1.5'): executable tool calls are NEVER emitted mid-stream.
      // A mid-stream block is legitimately incomplete; auto-closing it with
      // miniJsonRepair produced syntactically valid but semantically truncated
      // params (the eager writeFile bug). Repair is disabled on every scan, and
      // tool_call_detected/json_block_added actions are only emitted after
      // stream_end — the model ends its turn right after writing the tool JSON
      // (it needs the result), so the final block is naturally complete.
      // {"response": ...} blocks are not executable and keep flowing mid-stream.
      
      // FASE B: V2 Authority Gate - skip legacy if V2 is active
      if (!isV2BlockingLegacy('tool')) {
        const jsonBlocks = detectJsonBlocks(assistant, thinkingContainer, /* allowRepair */ false);
        if (_streamEndEmitted) {
          emitFinalToolCalls(assistant, jsonBlocks);
        }
      } else {
        console.log(`[V2_AUTHORITY][BLOCKED] time=${Date.now()} reason=legacy_tool_blocked_by_v2`);
      }
      
      if (!isV2BlockingLegacy('response')) {
        for (const resp of jsonBlocks.responses) {
          const key = hashString(String(resp.response));
          if (_detectedResponseKeys.get(key) !== assistant) {
            _detectedResponseKeys.set(key, assistant);
            queueEvent('tool_response_detected', { response: resp.response });
            queueEvent('json_block_added', { actions: [], responses: [{ response: resp.response }] });
          }
        }
      } else {
        console.log(`[V2_AUTHORITY][BLOCKED] time=${Date.now()} reason=legacy_response_blocked_by_v2`);
      }

      // ── stream end detection ──
      // v13.0 (F1.3): consensus signals, no more hair trigger. The Stop button
      // can disappear transiently during React re-renders mid-stream — the
      // 'button' signal only fires after the not-streaming state persists for
      // BUTTON_END_STABLE_MS. The bridge accepts completion only by consensus
      // (network primary, or ≥2 independent signals).
      if (nowStreaming) {
        _pendingButtonEndAt = 0;
      } else if (!_streamEndEmitted && (_wasStreaming || _pendingButtonEndAt)) {
        if (!_pendingButtonEndAt) {
          _pendingButtonEndAt = Date.now();
        } else if (Date.now() - _pendingButtonEndAt >= BUTTON_END_STABLE_MS) {
          queueEvent('stream_end', {
            signal: 'button',
            finalTextLength: _lastSentResponse.length,
            finalThinkingLength: _lastSentThinking.length
          });
          _streamEndEmitted = true;
          _pendingButtonEndAt = 0;
          emitFinalToolCalls(assistant); // v13.0 (F1.5'): final scan, no repair

          // Check if a valid protocol was detected this turn
          // If not, emit UNKNOWN_OUTPUT (only when turn ends without protocol)
          if (!_protocolDetectedThisTurn && _lastSentResponse.length > 0) {
            console.log(`[PROTOCOL][UNKNOWN_OUTPUT] time=${Date.now()} reason="turn ended without valid protocol" responseLength=${_lastSentResponse.length}`);
            queueEvent('luna_unknown_output', {
              text: _lastSentResponse,
              reason: 'turn ended without valid protocol'
            });
          }
        }
      }
      _wasStreaming = nowStreaming;

      // v2.6.4-fix: If real response text has appeared and the DOM stops changing
      // for a while, emit stream_end so the backend can finalize the turn. This covers
      // Kimi variants where the stop button state is not reliably detected.
      // v13.0 (F1.3): tertiary fallback signal — 5s (was 3s), labeled 'inactivity'.
      const stateHash = `${_lastSentThinking.length}|${_lastSentResponse.length}|${btnState.stopVisible}|${nowStreaming}`;
      if (stateHash !== _lastChangeHash) {
        _lastChangeHash = stateHash;
        _lastChangeTime = Date.now();
      } else if (!_streamEndEmitted && (Date.now() - _lastChangeTime > INACTIVITY_END_MS)) {
        queueEvent('stream_end', {
          signal: 'inactivity',
          finalTextLength: _lastSentResponse.length,
          finalThinkingLength: _lastSentThinking.length
        });
        _streamEndEmitted = true;
        emitFinalToolCalls(assistant); // v13.0 (F1.5'): final scan, no repair

        // Check if a valid protocol was detected this turn
        // If not, emit UNKNOWN_OUTPUT (only when turn ends without protocol)
        if (!_protocolDetectedThisTurn && _lastSentResponse.length > 0) {
          console.log(`[PROTOCOL][UNKNOWN_OUTPUT] time=${Date.now()} reason="turn ended without valid protocol" responseLength=${_lastSentResponse.length}`);
          queueEvent('luna_unknown_output', {
            text: _lastSentResponse,
            reason: 'turn ended without valid protocol'
          });
        }
      }

      // ── button state changes ──
      if (JSON.stringify(btnState) !== JSON.stringify(_lastButtonState)) {
        queueEvent('button_state', btnState);
        _lastButtonState = btnState;
      }

      cleanupDedup();
    } catch (e) {}
  }

  // ── Polling loops ──
  const pollTimer = setInterval(() => detectAndEmit(false), POLL_MS);
  const heartbeatTimer = setInterval(() => {
    const btnState = detectButtonState();
    if (btnState.stopVisible || _lastSentThinking || _lastSentResponse) {
      detectAndEmit(true);
    }
  }, HEARTBEAT_MS);

  // v11.7-fix: lightweight observer on the chat container only. This catches new
  // assistant segments and thinking containers the moment they appear, so we don't
  // miss the beginning of the reasoning while waiting for the poll timer.
  let _chatObserver = null;
  function setupChatObserver() {
    try {
      const chatContainer = findChatContainer();
      if (!chatContainer || _chatObserver) return;
      _chatObserver = new MutationObserver((mutations) => {
        let shouldScan = false;
        for (const m of mutations) {
          if (m.type === 'childList' && m.addedNodes.length > 0) {
            for (const node of m.addedNodes) {
              if (node.nodeType !== Node.ELEMENT_NODE) continue;
              const cls = className(node);
              if (cls.includes('assistant') || cls.includes('segment') || cls.includes('thinking') || cls.includes('toolcall')) {
                shouldScan = true;
                break;
              }
            }
          }
          if (m.type === 'attributes') {
            const name = (m.attributeName || '').toLowerCase();
            if (name === 'class' || name === 'data-status') shouldScan = true;
          }
          if (shouldScan) break;
        }
        if (shouldScan) {
          detectAndEmit(false);
        }
      });
      _chatObserver.observe(chatContainer, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-status'] });
    } catch (e) {}
  }
  setupChatObserver();

  setTimeout(() => detectAndEmit(false), 50);

  function teardown() {
    try {
      clearInterval(pollTimer);
      clearInterval(heartbeatTimer);
      if (_flushTimer) clearTimeout(_flushTimer);
      if (_chatObserver) _chatObserver.disconnect();
      flushEvents();
      delete window.__lunaDomObserver;
      delete window.__lunaObserverVersion;
    } catch (e) {}
  }

  window.__lunaDomObserver = {
    teardown,
    version: VERSION,
    stats: () => ({
      isObserving: true,
      url: window.location.href,
      lastAssistant: !!_currentAssistant,
      lastThinkingLen: _lastSentThinking.length,
      lastResponseLen: _lastSentResponse.length
    })
  };

  // v2.6.8-fix: expose a reset hook so the bridge can force a clean state at the
  // start of every new user turn. Without this, stale events from the previous
  // turn (which may still be in the content-script batch pipe) can overwrite the
  // new turn's thinking/response and make the stream lag by one message.
  // v2.6.9-fix: after resetting, prime the observer with the CURRENT DOM as
  // already-seen. Otherwise the old assistant/thinking container still on screen
  // is treated as "new" and the previous turn's thinking/response is re-emitted,
  // causing the next message to look like it answered the previous question.
  // v2.6.10-fix: also mark the current thinking/response as already-emitted so
  // the observer does not fire a fresh thinking_start for stale content while it
  // waits for the new turn's assistant bubble to appear.
  window.__lunaResetObserverState = () => {
    resetAssistantState();
    const currentAssistant = findLastAssistant();
    _currentAssistant = currentAssistant;
    const currentThinkingContainer = findThinkingContainer(currentAssistant);
    _lastSeenThinkingContainer = currentThinkingContainer;
    if (currentAssistant) {
      // Treat whatever is currently on screen as already streamed. This stops
      // the previous turn's thinking from seeding the new turn's bubble.
      _thinkingStartedEmitted = true;
      _lastSentThinking = currentThinkingContainer ? extractThinking(currentThinkingContainer) : '';
      _lastSentResponse = extractResponse(currentAssistant, currentThinkingContainer);
    }
    _resetPrimed = true;
    _lastChangeHash = '';
    _lastChangeTime = Date.now();
    _eventQueue = [];
    if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
    console.log(`[LunaExt DEBUG] observer state reset — primed assistant=${!!currentAssistant} thinkingLen=${_lastSentThinking.length} responseLen=${_lastSentResponse.length}`);
  };

  window.addEventListener('beforeunload', teardown, { once: true });

  // SPA navigation hooks
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function (...args) {
    const result = originalPushState.apply(this, args);
    queueEvent('spa_navigate', { method: 'pushState', url: window.location.href });
    return result;
  };
  history.replaceState = function (...args) {
    const result = originalReplaceState.apply(this, args);
    queueEvent('spa_navigate', { method: 'replaceState', url: window.location.href });
    return result;
  };

  // v2.6.11-fix: prime the observer with the current DOM on every injection.
  // Content-script SPA navigation (pushState/replaceState) tears down and
  // re-injects the observer, which would otherwise start with a clean slate and
  // treat the previous turn's bubble/thinking as brand-new. Priming here makes
  // the initial state identical to the explicit reset the bridge does before
  // each new message, so stale content is never re-streamed.
  if (typeof window.__lunaResetObserverState === 'function') {
    window.__lunaResetObserverState();
  }

  queueEvent('observer_ready', { url: window.location.href, version: VERSION });
  // SENTINEL: Envia através do pipeline para o servidor
  queueEvent('luna_build_sentinel', {
    sentinel: BUILD_SENTINEL,
    extensionUrl: EXTENSION_URL,
    version: VERSION,
    timestamp: Date.now()
  });

  // PERIODIC SENTINEL: Emite a cada 30 segundos para provar que o código está rodando
  setInterval(() => {
    queueEvent('luna_build_sentinel', {
      sentinel: BUILD_SENTINEL + '_PERIODIC',
      extensionUrl: EXTENSION_URL,
      version: VERSION,
      timestamp: Date.now()
    });
  }, 30000);

  console.log(`[Luna Injected] v${VERSION} active — mirroring Kimi UI every ${POLL_MS}ms`);
})();

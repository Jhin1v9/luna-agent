# Chrome Extension Robustness: Thinking/Response Boundary Fix

**Date:** 2026-08-02  
**Author:** Luna agent (interactive session)  
**Scope:** `packages/kernel/luna-extension/*`, `packages/kernel/kimi-bridge.cjs`, `apps/dashboard/luna-extension-handler.cjs`, `packages/kernel/luna-web/dist/`

## Problem Statement

Kimi's new web UI renders the reasoning step inside a dedicated `.toolcall-container.thinking-container` (or `.thinking-container`) element, then renders the actual answer/tool JSON outside that container. Luna's extension was:

1. Leaking thinking text into the response stream (and vice-versa), causing the thinking bubble to show JSON/tool text and the response bubble to show reasoning.
2. Treating JSON code blocks inside the thinking container as real tools/responses.
3. Sending `thinking_delta`/`response_delta` events that the bridge's HTTP extension handler was **not buffering**, so the events were frequently lost or delayed.
4. Running alongside the legacy Playwright fallback observer (`__lunaUltraLightObserver` + `__lunaEventQueue`) because bridge detection required `__lunaEventQueue`, which the extension no longer creates.
5. Flooding `chrome.runtime.sendMessage` with one call per DOM poll cycle, contributing to Chrome instability.

## Solution Overview

Use Kimi's own `.thinking-container` as the single source of truth:

- **Inside the container** → reasoning/thinking text only.
- **Outside the container** → real response or tool JSON.
- **End-of-thinking signal** → when any of these happen inside the thinking container:
  - the `is-expanded` class is removed (container collapsed);
  - a "JSON Copy" / "Copy" button appears;
  - a JSON code block appears;
  - non-empty text starts rendering outside the container.

Events are batched end-to-end and the bridge now buffers the correct event types.

## Files Changed

### 1. `packages/kernel/luna-extension/injected.js` (v2.4.0 → v2.5.1)

- Replaced broad thinking selectors with the dedicated `.toolcall-container.thinking-container` / `.thinking-container` source-of-truth selector.
- `extractThinking(container)` walks only the thinking container, stripping:
  - "Think / Thinking / Pensando / Analisando / Reasoning / Processando / Searching / Buscando" headers;
  - copy buttons ("JSON Copy", "Copy", etc.);
  - code/pre elements.
- `extractResponse(assistant, thinkingContainer)` scans response containers but **excludes** anything inside the thinking container or inside a tool container.
- `thinkingHasFinishedSigns(container)` detects the four end-of-thinking conditions listed above.
- Emits `thinking_start` immediately when thinking first appears.
- Emits `stream_state` events (bufferable by the server) carrying the **full** `thinking`, `response`, `isStreaming`, `isComplete`.
- Emits `tool_call_detected`, `tool_response_detected`, and `json_block_added` only for JSON blocks **outside** the thinking container.
- Added a lightweight `MutationObserver` on the chat container only, to spot the thinking container as soon as it appears.
- **v11.8 fix:** when a brand-new thinking container appears inside the same assistant bubble (e.g. before a follow-up tool in a multi-tool turn), the observer resets `_thinkingHasEnded` and emits a new `thinking_start`, so each reasoning step gets its own persistent bubble.
- Removed heavy `MutationObserver` on `document.documentElement`; uses an 80ms poll + 600ms heartbeat resync while streaming.
- **v2.5.2 fix:** `extractResponse()` now skips any response-container node that **contains** the thinking container as a descendant. Previously a high-level wrapper like `.segment-content-box` matched the response selector and `safeText()` pulled the collapsed reasoning text ("Raciocínio concluído") into the response bubble.
- **v2.5.2 fix:** thinking-header stripping recognizes Portuguese UI strings (`Raciocínio`, `Concluído`, `Raciocinando`, `Concluindo`) so the bubble title does not leak into the reasoning text.

### 2. `packages/kernel/luna-extension/content.js` (v8.1 → v11.7)

- Accepts `luna_event_batch` from `injected.js`.
- Maintains a local forward queue and flushes to the background script:
  - when the queue reaches 25 events, or
  - every 80ms.
- Reduces `chrome.runtime.sendMessage` traffic by roughly one to two orders of magnitude during fast streaming.
- Tears down the legacy Playwright fallback observer on re-injection.
- **v11.7 fix:** `findInput()` now targets the new Kimi composer (`[class*="chat-input"]`, `[class*="composer"]`, `.input-area`), preferring `contenteditable` with placeholder or `textarea` with placeholder "Ask" / "Pergunte".
- **v11.7 fix:** `injectToolResult()` is async and waits up to 3s for the input to appear.
- **v11.7 fix:** `setInputValue()` uses `execCommand` plus a `Range/Selection` fallback for Lexical editors.
- **v11.7 fix:** `clickSendButton()` searches the composer first, then globally, and checks `data-testid`, aria-label and SVG.
- **v11.8 fix:** `clickSendButton()` tries `Enter` on the focused input first; button-click is now the fallback. This is more reliable because Kimi's send button is frequently disabled/re-enabled by React state, while the input's Enter handler is always wired.
- **v11.7-fix-ctx:** Added `isExtensionContextValid()` guard and `stopForwarding()` cleanup. Every `chrome.runtime.sendMessage` is wrapped in `try/catch`; if the extension context is invalidated (reload, disable, SW killed) the content script stops forwarding and drains the queue silently instead of throwing `Extension context invalidated`.

### 3. `packages/kernel/luna-extension/background.js` (v8.1 → v11.6)

- Accepts `luna_event_batch` from the content script.
- Explodes the batch into individual `POST /ext/event` calls while preserving `tabId`, `tabUrl`, `timestamp`, and `version`.

### 4. `apps/dashboard/luna-extension-handler.cjs`

- Added `thinking_start` to `bufferableTypes` so the bridge can consume it through the global event buffer.

### 5. `packages/kernel/kimi-bridge.cjs`

- Fixed `_injectEventQueueObserver` extension detection: now checks `window.__lunaDomObserver && window.__lunaObserverVersion` instead of the legacy `__lunaEventQueue`.
- When the extension is present, the bridge disconnects `__lunaUltraLightObserver` and clears `__lunaEventQueue` so the Playwright fallback does not compete.
- `_consumeExtensionEvents` now translates `thinking_start` into the internal `thinking_start` event type, and continues to translate `stream_state` → `state_change`.
- **v11.7 fix:** for extension `state_change` events, emits `thinking_update` with the **full current thinking text** instead of `thinking_delta` slices, so the frontend replaces the bubble content rather than accumulating deltas.

### 6. `packages/kernel/luna-web/src/components/ChatArea.svelte`

- **v11.7 fix:** added `thinking_update` handler that replaces the whole thinking bubble content with the full text from Kimi. This makes the Luna thinking bubble a live mirror of Kimi's `.thinking-container`.
- **v11.8 fix:** `thinking_start` no longer calls `removeAllThinking()` inside the same turn. Each reasoning step now persists as its own bubble, just like tool cards, so successive tools do not erase the previous thinking.

### 7. `packages/kernel/luna-web/dist/`

- Rebuilt from source so the production static bundle matches the current frontend.

### 8. `packages/kernel/.brain/status.md`

- Added a "Chrome Extension: robust thinking/end-of-thinking detection" section documenting the changes.

## Technical Decisions

1. **Why `stream_state` instead of `thinking_delta`/`response_delta`?**
   The HTTP extension handler only buffers a fixed list of event types. `thinking_delta` and `response_delta` were not in that list, so they were being dropped. `stream_state` is already translated by `_consumeExtensionEvents` into `state_change`, which the bridge's `sendMessageStream` loop already handles.

2. **Why `thinking_update` (full replace) instead of `thinking_delta`?**
   The Kimi page is the source of truth. Delta accumulation is fragile: a single missed or drifted delta permanently truncates or duplicates the thinking bubble. Sending the full thinking text every cycle and replacing the bubble content guarantees Luna always matches Kimi exactly.

3. **Why poll instead of MutationObserver?**
   The previous MutationObserver on `document.documentElement` forced Chrome to clone attributes and notify on every DOM change during Kimi's streaming, causing GC pauses and tab instability. An 80ms poll reading only the last assistant segment is far cheaper. A lightweight chat-container MutationObserver is still used only to trigger an immediate scan when a new assistant/thinking node appears.

4. **Why batch inside the extension instead of per event?**
   During fast streaming the injected script can emit 50–100 events per second. Without batching, each event becomes a `postMessage` → `chrome.runtime.sendMessage` → HTTP POST chain. Batching at 25 events / 80ms keeps the message channel responsive without saturating it.

5. **Why detect thinking-end via UI signals?**
   Kimi does not emit an explicit "thinking ended" event. The appearance of a JSON Copy button or a JSON code block inside the thinking container, or the container collapsing, is a reliable proxy that the model has switched from reasoning to output generation.

6. **Why guard every `chrome.runtime.sendMessage`?**
   MV3 content scripts keep running for a short time after the extension is reloaded, disabled, or the service worker is terminated. In that window any `chrome.runtime` API throws synchronously with "Extension context invalidated". Checking `chrome.runtime.id` before each call and catching the remaining throws prevents the error from surfacing in the page console and stops the dead content script cleanly.

## Validation Steps

1. Open `chrome://extensions`, enable Developer mode, and click **Reload** on the Luna Extension.
2. Refresh the Kimi tab where Luna will chat.
3. Send a message in Luna Web.
4. Expected behavior:
   - A "Pensando" bubble appears immediately.
   - The bubble shows exactly what Kimi shows inside its `.thinking-container`, from the first word to the last.
   - When Kimi starts emitting the real answer/tool JSON, the thinking bubble stops updating (but stays visible).
   - Response/tool content appears in its own stream without reasoning leakage.
   - Tool results are injected back into Kimi's input and sent.
   - No duplicate assistant messages or duplicate tool cards.

## Risks / Residuals

- If Kimi changes the CSS class names of the thinking container, the selectors will need to be updated. The selector list is centralized in `getSelectors().thinkingContainer`.
- The end-of-thinking heuristic assumes the JSON Copy button appears before or at the same time as real output. If Kimi changes that ordering, thinking may bleed slightly into the response bubble.
- The extension must be manually reloaded in Chrome after any `injected.js` edit; there is no auto-reload mechanism.

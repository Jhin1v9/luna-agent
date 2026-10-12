# Thinking Cursor: Source-of-Truth Diffing

**Date:** 2026-08-02
**Author:** Luna agent (interactive session)
**Scope:** `packages/kernel/kimi-bridge.cjs`, `packages/kernel/luna-soul.cjs`, `apps/dashboard/luna-chat-routes.js`

## Problem Statement

The response stream in Luna Web is accurate because `kimi-bridge.cjs` diffs Kimi's full response text against a per-source cursor (`stream-text-cursor.cjs`) and emits only clean `response_delta` chunks.

The thinking stream did not use the same technology. The bridge emitted `thinking_update` events carrying the full current reasoning text. This caused two problems:

1. **Phase 0 swallowed the first thinking.** In `sendMessageStream`, Phase 0 seeds `lastThinking` with the initial thinking text so the first Phase 1 event is not re-emitted. With `thinking_update` (full snapshot), the first event had the same text as the seed, so it was dropped and the frontend never received any thinking content.
2. **Backend forwarding was fragile.** `luna-soul.cjs` and `luna-chat-routes.js` had to be taught about `thinking_update` specially, including a custom `fullText` field.

Result: the Luna Web "Pensando" bubble stayed empty ("Analisando...") even though Kimi's page showed reasoning text.

## Solution Overview

Treat thinking exactly like response: diff the full reasoning text from Kimi against a per-source cursor and emit clean `thinking_delta` chunks.

This makes the Kimi page the single source of truth and reuses the proven cursor logic from `stream-text-cursor.cjs`.

## Files Changed

### 1. `packages/kernel/kimi-bridge.cjs`

- Created a second cursor instance for thinking alongside the response cursor:
  ```javascript
  const responseCursor = createResponseCursor();
  const thinkingCursor = createResponseCursor();
  ```
- In Phase 0, seeded the thinking cursor with the initial thinking text (same as response):
  ```javascript
  responseCursor.next(ev.source || 'phase0', lastResponse);
  thinkingCursor.next(ev.source || 'phase0', lastThinking);
  ```
- Replaced the `thinking_update` emission logic with per-source diffing:
  ```javascript
  if (t) {
    const { emit, diverged } = thinkingCursor.next(ev.source, t);
    if (diverged) { /* log once per source */ }
    if (emit) {
      yield { type: 'thinking_delta', text: emit, fullThinking: t };
      lastThinking = t;
    }
  }
  ```

### 2. `packages/kernel/luna-soul.cjs`

- Removed the temporary `thinking_update` case added in the previous fix.
- Kept the existing `thinking_delta` accumulation:
  ```javascript
  case 'thinking_delta':
    fullThinking += event.text;
    yield { type: 'thinking_delta', text: event.text, fullThinking, sessionId };
    break;
  ```

### 3. `apps/dashboard/luna-chat-routes.js`

- Removed `thinking_update` from the allowed event list.
- Removed the `fullText` special-case forwarding for `thinking_update`.
- `thinking_delta` continues to be persisted and forwarded normally.

### 4. `packages/kernel/luna-web/src/components/ChatArea.svelte`

- No changes required. The existing `thinking_delta` handler accumulates deltas into the current thinking bubble, and the `thinking_update` handler remains as a defensive fallback.

## Validation

```bash
cd packages/kernel
node tests/wave10-autocompact.test.cjs
```

Result: **22/22 tests passing**.

Server restarted via `luna`:

- `luna-server` on :3458
- `nexo-dashboard` on :3456
- `luna-health-watchdog` online

## User Action Required

Reload the Luna Chrome extension at `chrome://extensions` and refresh the Kimi tab. Then send a message in Luna Web.

Expected behavior:

1. A "Pensando" bubble appears as soon as Kimi starts reasoning.
2. The bubble fills incrementally with Kimi's reasoning text, exactly like the response fills with `response_delta`.
3. The thinking bubble remains visible after the response/tool appears.

## Risks / Residuals

- If Kimi clears or rebuilds the thinking container, the cursor may see a `thinking` text that does not start with the previous committed text. The cursor treats this as a reset and emits nothing for that jump (same behavior as response divergence). The bubble may skip a segment but will not duplicate text.
- Different sources (Chrome extension vs. Playwright DOM poller) are isolated by per-source cursors, so divergent extractions do not interfere with each other.

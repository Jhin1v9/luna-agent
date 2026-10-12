# Thinking Update Event Passthrough Fix

**Date:** 2026-08-02
**Author:** Luna agent (interactive session)
**Scope:** `packages/kernel/luna-soul.cjs`, `apps/dashboard/luna-chat-routes.js`

## Problem Statement

Kimi's web UI shows the reasoning step inside a `.thinking-container`. The Luna Chrome extension extracts this text and forwards it as `stream_state` events. The bridge (`kimi-bridge.cjs`) translates those into `thinking_update` events carrying the **full current thinking text** (`fullText`), so the frontend can replace the bubble content with Kimi's exact reasoning.

The frontend (`ChatArea.svelte`) already knew how to render `thinking_update` since v11.7, but the event never reached it because two backend layers dropped it:

1. `luna-soul.cjs` only handled `thinking_delta`; `thinking_update` fell through the switch with no `yield`.
2. `apps/dashboard/luna-chat-routes.js` did not list `thinking_update` as a forwardable event type, so it was ignored when persisting/forwarding SSE messages.

Result: the Luna Web thinking bubble stayed empty ("Analisando...") even though Kimi's page had reasoning text and the extension logs showed `thinking=776`.

## Solution Overview

Teach the backend to recognize and forward `thinking_update` exactly like `thinking_delta`, preserving the `fullText` field so the frontend can replace the bubble content.

## Files Changed

### 1. `packages/kernel/luna-soul.cjs`

Added a `thinking_update` case in both the chat stream loop and the plan-mode stream loop:

```javascript
case 'thinking_update': {
  const t = event.fullText || event.thinking || '';
  if (t && t !== fullThinking) {
    fullThinking = t;
    yield { type: 'thinking_update', fullText: t, sessionId };
  }
  break;
}
```

This mirrors the `thinking_delta` handling but passes the full snapshot instead of a delta.

### 2. `apps/dashboard/luna-chat-routes.js`

- Added `'thinking_update'` to the allow-list of events that are persisted and forwarded via SSE (chat route and plan-mode route).
- For `thinking_update`, the persisted `content` is taken from `ev.fullText` before falling back to `ev.text` / `ev.fullResponse`.
- When replaying from the event ledger or sending live SSE, `eventData.fullText = msg.content` is set for `thinking_update` so the frontend receives the field it expects (`event.fullText`).

## Validation

```bash
cd packages/kernel
node tests/wave10-autocompact.test.cjs
```

Result: **22/22 tests passing**.

Server restarted cleanly via the `luna` command:

- `luna-server` on :3458
- `nexo-dashboard` on :3456
- `luna-health-watchdog` online

## User Action Required

No frontend rebuild is needed. Reload the Luna Chrome extension at `chrome://extensions` to ensure the latest `injected.js` scanner is active, then test a message in Luna Web.

Expected behavior:

1. A "Pensando" bubble appears as soon as Kimi starts reasoning.
2. The bubble fills with Kimi's exact reasoning text (full replacement, not delta accumulation).
3. When reasoning ends, the bubble stops updating but remains visible.
4. The final response/tool JSON appears in its own card.

## Risks / Residuals

- If Kimi changes the CSS selectors for the thinking container, the extension will need updating. Selectors are centralized in `getSelectors().thinkingContainer` / `.thinkingText`.
- Very long reasoning text is sent in full on every poll cycle. This is bounded by Kimi's own DOM update rate (the extension polls every 80ms but only emits when text changes) and is acceptable for current usage patterns.

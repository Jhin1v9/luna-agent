# Runbook: Compaction stuck / failed

## Flow and invariants

Manual compaction (`POST /api/luna/compact` → `_compactContext`, luna-soul.cjs:1755):

```
summary (_buildCompactSummary)
  → _clearChatUrl + newChat(requireChatUrl: false)
  → checkpoint via sendMessageNoWait(summary, mode: 'thinking', 120s race timeout)
  → _captureCurrentChatUrl (confirm new thread URL)
  → clearContext (LOCAL) + append [CHECKPOINT] event
```

**Invariant:** local context is cleared ONLY after the new thread URL is confirmed. Every
earlier failure yields `compact_error` with "Contexto preservado" — **retrying is always
safe**; nothing was lost.

## If it fails

1. Just retry — the local context is intact by design.
2. Watch `pm2 logs luna-server` for the failing stage (each stage logs
   `[DEBUG-LUNA] _compactContext finished (...)`).
3. Match the stage to a known cause below, fix it, retry.

## Known causes

- **`NEW_CHAT_FAILED`** (kimi-bridge.cjs:3021): the new-chat navigation landed on a URL
  that didn't validate as a real chat. Classic trigger: Kimi adds a **trailing slash** or
  reorders query params on the landing URL, so the string comparison fails. Fix in code:
  `normalizeBaseUrl` (kimi-bridge.cjs:124) strips trailing slashes and ignores
  query/hash when comparing — covered by `packages/kernel/tests/url-landing.test.cjs`.
  If this regresses, that's the function to check.
- **Lexical editor not filled**: the checkpoint message never appears in the composer.
  `_fillContentEditable` (kimi-bridge.cjs:3781) handles Kimi's contenteditable/Lexical
  input; if Kimi changes its editor, this function (and the `input` selector in
  `provider-configs/kimi.json`) is where to fix it. Symptom: `sendMessageNoWait`
  (kimi-bridge.cjs:4044) hangs until the 120s checkpoint timeout.
- **Login lost / Chinese locale**: if the page shows the login screen, follow
  `.agents/runbooks/login-kimi-caiu.md` first. The modeUrls force the English locale and
  a fresh-chat entry — e.g. `https://www.kimi.com/en?chat_enter_method=new_chat`
  (`provider-configs/kimi.json`; bridge defaults at kimi-bridge.cjs:69-70) — so a login
  redirect or locale drift breaks new-chat detection.
- **agent/swarm mode active**: `sendMessageNoWait` throws for agent/swarm modes
  (kimi-bridge.cjs:4050). The checkpoint is sent with `mode: 'thinking'` explicitly, but
  a broken mode switch earlier can leave the page in a bad state — navigate the Kimi tab
  back to the base URL and retry.

## Manual trigger

```bash
curl -s -N -H 'Accept: text/event-stream' -H 'Content-Type: application/json' \
  -X POST http://localhost:3458/api/luna/compact \
  -d '{"sessionId":"<session>","userId":"luna-default"}'
```

Expected event sequence: `compact_start` → `compact_progress`* → `compact_end`
(with `chatUrl` of the new thread). Any `compact_error` event means: fix the cause, retry.

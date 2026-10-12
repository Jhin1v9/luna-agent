# Context Limit Detection: Portuguese Banner Fix

**Date:** 2026-08-02
**Author:** Luna agent (interactive session)
**Scope:** `packages/kernel/kimi-bridge.cjs`, `packages/kernel/bridge-libs/dom-scripts/poll-dom-structure.js`, `packages/kernel/tests/wave10-autocompact.test.cjs`

## Problem Statement

When Kimi's web UI is in Portuguese and the conversation reaches its context limit, the banner reads:

> "Você e o Kimi conversaram bastante. Tente iniciar um novo chat."

Luna's context-limit detector did not match this wording. The old regex only caught:

- `conversa muito longa`
- `conversação muito longa`
- `nova sessão`

Because `"conversaram bastante"` and `"iniciar um novo chat"` were missing, the auto-compact flow never triggered in Portuguese. The user had to run `/refresh` or manually start a new chat, losing the seamless auto-compact behavior that works in English and Chinese.

## Solution Overview

Broadened the regex in both detection layers so Portuguese and Spanish context-limit banners are recognized reliably.

## Files Changed

### 1. `packages/kernel/kimi-bridge.cjs` (`_isContextLimitResponse`)

- Added Portuguese variants:
  - `convers[ao].*(?:muito longa|bastante|demais|muitas mensagens)`
  - `conversaram bastante`
  - `conversamos bastante`
  - `muita conversa`
  - `nova sess[ãa]o`
  - `nova conversa`
  - `iniciar um novo chat`
  - `começar um novo chat`
  - `inicie um novo chat`
  - `tente iniciar um novo chat`
- Added Spanish variants:
  - `nuevo chat`
  - `nueva sesión`
  - `sesión.*(?:muy larga|muy longa|demasiado larga|demasiado longa)`
- Kept existing English and Chinese patterns.

### 2. `packages/kernel/bridge-libs/dom-scripts/poll-dom-structure.js` (`scanPageContextLimit`)

- Regex synchronized with `KimiBridge._isContextLimitResponse()` so page-level banner detection and text-based detection use the same patterns.
- Scanner continues to skip `.segment-user` and `.segment-assistant` bubbles to avoid false positives from messages that merely mention the phrase.

### 3. `packages/kernel/tests/wave10-autocompact.test.cjs`

- Increased the source slice used to extract the regex literal from 500 to 1500 characters, because the new regex is longer.
- Added assertions verifying the Portuguese banner text is detected by both the bridge and the scanner.

## Validation

```bash
cd packages/kernel
node tests/wave10-autocompact.test.cjs
```

Result: **22/22 tests passing**.

Server stack restarted cleanly via the `luna` command:

- `luna-server` on :3458
- `nexo-dashboard` on :3456
- `luna-health-watchdog` online

## User Action Required

No code changes are needed, but if the Chrome extension is already loaded in the browser, reload it at `chrome://extensions` so the updated `poll-dom-structure.js` scanner is re-injected into the Kimi tab.

## Risks / Residuals

- If Kimi changes the exact wording of the Portuguese/Spanish banner, the regex may need another update. The patterns are now broad enough to cover common synonyms and verb conjugations.
- The page-level scanner walks every `div/span/p/h/li` on the page. On very long chats this is throttled to once every 5 seconds to keep overhead low.

# Architecture

> Verified against the code on 2026-07-11. Paths are relative to the repo root
> (`~/.luna-kernel`). When behavior changes, update this file in the same commit.

## What Luna is

Luna is a **mirror agent**: reasoning happens inside the Kimi or DeepSeek **web apps**
(kimi.com, chat.deepseek.com), driven through a **real Chrome** controlled over CDP
(primary port `:9222`) by `packages/kernel/kimi-bridge.cjs`. The model never executes
anything directly — it emits JSON tool blocks, and Luna (`packages/kernel/luna-soul.cjs`)
translates those blocks into real Linux actions (files, shell, git, dashboard APIs) and
feeds the results back for the next turn.

## Web pipeline

```
User
  → Luna Web UI (Svelte 4 + Vite, static build served from
    packages/kernel/luna-web/dist by luna-server on :3458; dev server on :5173)
  → apps/dashboard/luna-server.js  (Express, serves dist + mounts routers)
  → apps/dashboard/luna-chat-routes.js  (chat/SSE routes)
  → packages/kernel/luna-soul.cjs :: processMessageStream
  → packages/kernel/kimi-bridge.cjs  (Playwright chromium.connectOverCDP → :9222)
  → kimi.com  (model reasons, emits ```json blocks)
  → parseKimiResponse (luna-soul.cjs)
  → packages/kernel/luna-tools.cjs  (executes the tool on the real PC)
  → tool result fed back to Kimi
  → loop until the model emits {"response": "..."}
```

## Telegram pipeline

```
Telegram message
  → packages/kernel/telegram-luna-adapter.cjs  (polling; bot client from
    apps/dashboard/services/telegram-bot-client.cjs)
  → POST to luna-server with options.channel = 'telegram'
  → luna-soul.cjs :: processMessageStream  (channel check at line ~2271)
  → _telegramPipeline (luna-soul.cjs:4987):
      1. _classifyIntent — asks Kimi for ONE category
         (categories from dashboard-tool-registry.cjs, plus CHAT)
      2. _selectDashboardTool — asks Kimi to pick a tool from that category only
      3. _executeDashboardTool — isDashboardTool() guard: ONLY dashboard* tools run;
         local tools (shell/file/git) are rejected on this channel
         ("Tool não permitida no Telegram.")
      4. _formatTelegramResponse — persona-formatted reply
  (CHAT / unclassified → _telegramChatResponse, no tools)
```

## Key components

| File | Responsibility |
|---|---|
| `packages/kernel/luna-soul.cjs` | Brain/orchestrator: prompt building (`buildSystemPrompt`), stream loop (`processMessageStream`), JSON parsing (`parseKimiResponse`), plan mode, manual compaction (`_compactContext`), Telegram pipeline (`_telegramPipeline`) |
| `packages/kernel/kimi-bridge.cjs` + `bridge-libs/` | Playwright/CDP control of the provider web apps: pages per user, mode switching, message send/read, tool-call detection, cookie backup, Chrome lifecycle |
| `packages/kernel/luna-tools.cjs` | Implementation of the tools the model can call (shell, files, git, dashboard*, web search, etc.) |
| `packages/kernel/luna-tool-guard.cjs` | Resilience around tool calls: retry with backoff, circuit breaker, idempotency keys, schema validation, timeouts, file checksum drift detection, git stash checkpoints |
| `packages/kernel/luna-code-validator.cjs` | Post-write code validation (unclosed JSX tags, truncated files, missing imports, broken build, missing title) |
| `apps/dashboard/luna-chat-routes.js` | HTTP/SSE routes for chat, plan mode, `POST /api/luna/execute`, `POST /api/luna/compact`; wires `LunaSoul` into `luna-server.js`. (`packages/kernel/luna-chat-routes.js` does **not** exist.) |
| `packages/kernel/luna-api-server.cjs` | Legacy standalone HTTP server whose compact endpoint only **simulates** events — not the real pipeline. Kept for reference; do not extend. |
| `packages/kernel/telegram-luna-adapter.cjs` | Telegram bot process (polling). PM2 name: `luna-telegram-adapter`. |
| `packages/kernel/dashboard-tool-registry.cjs` | Single registry of dashboard tool categories (tarefas, leads, financeiro, histórico, …) used by the Telegram pipeline |
| `packages/kernel/luna-extension/` | Chrome extension (Manifest V3): persistent MAIN-world DOM observer on provider pages |
| `packages/kernel/provider-configs/` | Per-provider config JSON (`kimi.json`, `deepseek.json`): modeUrls, selectors, CDP patterns, cookie file names |

## Tool call detection

Three layers exist in `kimi-bridge.cjs` (Layers 2–4 were removed in v8.5):

- **Layer 0 — Chrome extension (highest priority).** `luna-extension/injected.js` runs a
  `MutationObserver` in the MAIN world of kimi.com and maintains `window.__lunaEventQueue`;
  events flow `postMessage → content.js → background.js → fetch POST http://localhost:3458/ext/event`
  → `apps/dashboard/luna-extension-handler.cjs` buffers them in
  `global.__lunaExtensionEventBuffers` → the bridge consumes them via
  `_consumeExtensionEvents()` (kimi-bridge.cjs:5172).
  **v13.0:** executable tool calls are emitted ONLY after `stream_end` (final scan,
  `allowRepair` disabled — repaired JSON never becomes a tool call), and `stream_end`
  carries a labeled consensus signal (`signal: 'button'|'inactivity'`).

## Stream completion (v13.0)

A turn ends by **consensus**, not by a single heuristic: the bridge accepts completion
when the network source-of-truth fired (this turn's chat HTTP body fully arrived —
`ProviderNetworkInterceptor.completedGeneration === _generation`, turn-isolated since
F1.1), or ≥2 distinct observational signals (`button`, `inactivity`, `dom_vote`), or the
DOM poller's composite vote sustained across ≥2 emissions. After acceptance the turn's
TEXT is immutable (no post-completion drain); only the final `action_detected` scan is
processed. The final response text comes primarily from `responseCursor.committed` —
DOM re-reads and the interceptor are fallbacks only.

## Parsing, limits and thread persistence (v13.1)

- JSON extraction is brace-balance scanning (`extractBalancedJsonObjects` in
  `lib/tool-json-parser.cjs`): code fences are decoration, never structure — a fence
  inside a JSON string no longer truncates the object (the non-greedy fence regex
  rejected valid responses as "corrupted" and leaked raw JSON into the chat).
- **No caps** (owner directive 2026-08-13): no char caps on tool results/feedback/
  history/display, full-file `readFile` by default, no secret scrubbing
  (`_scrubSecrets` is identity — its generic base64 pattern mangled real paths), and
  **no global tool-count ceiling** (`MAX_LOOPS` removed; runaway protection is
  semantic: circuit breaker on identical repeats, cached-replay stop, bounded
  truncated-JSON retries). Limits apply only when the caller passes them explicitly.
- The streaming path persists the Kimi thread URL (`/chat/<id>`) at the end of every
  turn — page/Chrome/server loss now resumes the same thread instead of opening a
  new chat.
- **Layer 1 — CDP network interceptor** (native Playwright request interception; marked
  PRIMARY in code comments for stream capture). Layer 1b (legacy JS-injected interceptor)
  is deprecated.
- **Layer 2.5 — DOM structure extraction** (Playwright DOM mirror fallback).

## Dedup — 4 layers

1. **Extension handler** (`luna-extension-handler.cjs:15`): `processedToolCalls` map with
   TTL — safety net against duplicate events from the extension itself.
2. **Bridge cross-layer key** (`kimi-bridge.cjs:7839` `_dedupKeyForAction`): sha256 of
   `tool + normalized params`; the same action detected by different detection layers
   produces the SAME key and is filtered by the per-stream `emittedActionCodes` set
   (kimi-bridge.cjs:7410–7471, 7614, 7788).
3. **Soul cache dedup** (`luna-soul.cjs:2455`, v10.24): dedup via cache and emission of a
   stable `toolInstanceId` for DOM-detected tool calls (also applied to plan-mode actions,
   line 2883).
4. **Soul step dedup** (`luna-soul.cjs:772`, v8.3): identical steps are deduplicated before
   a PLAN or ACTION is created.

## Modes

`instant`, `thinking` (agent/swarm removed in Wave 7, 2026-07-12). instant/thinking switch
via the Kimi UI mode selector (Kimi only); for DeepSeek the mode is stored but no UI
switch happens. Mode URLs come from `provider-configs/*.json`
(e.g. kimi instant/thinking: `https://www.kimi.com/en?chat_enter_method=new_chat`),
with fallbacks in `packages/kernel/config/luna-config.js` (`KIMI.modeUrls`) and `kimi-bridge.cjs:69`.

## Destructive-operation confirmation gate

Only explicitly destructive tools require frontend confirmation; everything else runs
with full permissions (owner decision). Triggers: `deleteFile`, `removeDirectory`,
`dashboardDelete*`, `executeShell`/`executeScript` commands matching destructive patterns
(`rm -rf`, `git reset --hard`, `mkfs`, etc.).

Flow:

```
_handleAction detects destructive tool
  → _requestConfirmation() emits confirmation_required via EventBus + EventEmitter
  → SSE stream forwards confirmation_required to the UI
  → ToolCard renders Confirm/Cancel buttons
  → user clicks → POST /api/luna/confirm → LunaSoul.confirmAction()
  → pending Promise resolves; tool executes (or returns user-canceled error)
```

- Timeout: 5 minutes; unresolved confirmations auto-cancel.
- `autoConfirmDestructive: true` disables the gate entirely.
- The `action_start` event carries `toolInstanceId`; `confirmation_required` uses the same
  id so the frontend maps the confirmation to the correct card.
- **v13.0 (F2.3):** the frontend treats confirmation as a state machine — `action_end`
  clears the confirmation state and records the id in `completedToolInstanceIds`; a
  replayed/reconnect `confirmation_required` for a completed id is rejected as stale
  (no more ghost Confirm/Cancel cards).

## Tool-result feedback invariant (v13.0)

A tool that EXECUTED always gets its result fed back to Kimi — the wave1-A3 wrapper
oracle that discarded executed results was removed (LB2), and structured results
serialize through `LunaSoul._serializeToolResultForFeedback`
(`stdout|output|text|content` → filtered `JSON.stringify`) so tools like `gitStatus`
no longer fall into a black hole. Truncated tool JSON is never executed AND never
swallowed as chat: the soul asks Kimi to re-emit it complete ([CHECK] with the raw
excerpt, max 3 retries — LB1).

## Compaction

**100% manual** (all automatic triggers removed 2026-07-04, commit 18a569a):

```
POST /api/luna/compact  (luna-chat-routes.js:1913)
  → _compactContext (luna-soul.cjs:1755):
      1. read session events → _buildCompactSummary ("brain transplant" summary)
      2. _clearChatUrl(userId)
      3. kimiBridge.newChat(requireChatUrl: false)
      4. wait for new chat input, then sendMessageNoWait(summary, mode: 'thinking')
         with a 120s race timeout — the checkpoint message
      5. _captureCurrentChatUrl → confirm the new thread URL
      6. ONLY THEN sessionManager.clearContext(sessionId) + append a [CHECKPOINT] event
```

Invariant: **local context is cleared only after the new thread URL is confirmed.** Any
failure before step 6 yields `compact_error` and preserves the local context — safe to retry.

## Multi-provider

Providers are defined in `packages/kernel/provider-configs/*.json` (loaded by
`provider-loader.cjs`). Each config carries `modeUrls`, DOM `selectors`, `cdpPatterns`,
and `cookies` file names (e.g. `kimi-master-cookies.json` / `kimi-master-localstorage.json`,
`deepseek-master-cookies.json` / `deepseek-master-localstorage.json`). Cookie/localStorage
state is kept per provider; the Kimi login additionally has an auto-backup
(`packages/kernel/kimi-cookies.json`, rewritten every ~5 minutes — kimi-bridge.cjs:1250)
and a manual-import file (`packages/kernel/kimi-cookies.manual.json`). See
`.agents/runbooks/login-kimi-caiu.md`.

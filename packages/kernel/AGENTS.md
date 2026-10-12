# AGENTS.md — Luna Web

> "README for machines." This file guides AI coding assistants working on the Luna Web project.

---

## Overview

Luna Web is a Svelte 4 SPA that serves as the frontend for **Luna** — an AI assistant powered by Kimi Web (via a Chrome/Playwright bridge). The app features real-time SSE streaming, tool execution cards, plan mode, and integrated dashboards (Tasks, Leads, Finance).

**Architecture:**
```
User → Luna Web (Svelte) → luna-server (Node) → luna-soul.cjs → kimi-bridge.cjs → Kimi Web (Chrome)
                                        ↓
                                   luna-tools.cjs → Dashboard API (NEXO)
```

---

## Tech Stack

- **Frontend:** Svelte 4, Vite, vanilla CSS (custom properties), highlight.js
- **Backend:** Node.js, Express, SSE (Server-Sent Events)
- **Bridge:** Playwright + Chrome Extension (DOM observation)
- **Deployment:** PM2 (`luna-server` on port 3458)

---

## Commands

```bash
# Dev (hot reload)
cd packages/kernel/luna-web && npm run dev

# Production build
cd packages/kernel/luna-web && npm run build

# Start / restart the whole stack on Windows
cmd:   luna
bash:  luna

# Or directly via PM2 from the monorepo root
pm2 start pm2-ecosystem.config.js
pm2 restart all

# Check logs
pm2 logs luna-server
pm2 logs luna-server --err
```

---

## Project Structure

```
packages/kernel/luna-web/
├── src/
│   ├── components/          # Svelte components
│   │   ├── ChatArea.svelte       # Main chat — SSE connection, event handlers
│   │   ├── MessagesList.svelte   # Renders message list
│   │   ├── AssistantMessage.svelte
│   │   ├── UserMessage.svelte
│   │   ├── ThinkingBubble.svelte
│   │   ├── TypingIndicator.svelte
│   │   ├── ToolCard.svelte
│   │   ├── Sidebar.svelte        # Session list + search
│   │   ├── TaskDashboardModal.svelte
│   │   ├── LeadDashboardModal.svelte
│   │   ├── FinanceDashboardModal.svelte
│   │   ├── VotingDashboardModal.svelte
│   │   └── ConfigDrawer.svelte
│   ├── stores.js            # Svelte stores (messages, sessions, currentMode, etc.)
│   ├── api.js               # HTTP API + SSEManager class
│   ├── utils.js             # formatTime, scrollManager, etc.
│   └── App.svelte
├── dist/                    # GENERATED — never edit manually
├── public/
└── index.html

Backend (monorepo layout):
├── apps/dashboard/luna-server.js      # Express server entrypoint (port 3458)
├── apps/dashboard/luna-chat-routes.js  # Chat API + SSE routes
├── packages/kernel/luna-soul.cjs      # Main orchestrator — message loop, tools
├── packages/kernel/kimi-bridge.cjs    # Playwright/CDP bridge to Kimi/DeepSeek Web
├── packages/kernel/luna-tools.cjs     # Tool implementations (file ops, dashboard APIs)
├── packages/kernel/luna-tool-guard.cjs # Safety guard for destructive operations
└── packages/kernel/config/luna-config.js # Centralized config
```

---

## Code Style

- **Svelte:** Use `<script>` at top, then template, then `<style>`.
- **CSS:** Use CSS custom properties (`--luna-*`). Dark theme only.
- **Naming:** camelCase for JS/variables, kebab-case for CSS classes.
- **Stores:** Import from `../stores.js`. Never create ad-hoc event buses.
- **Icons:** Inline SVGs. Never add icon libraries.

---

## Event Flow (Critical)

Luna is a **mirror agent**: it has no brain of its own. The actual reasoning happens inside Kimi Web or DeepSeek Web. Luna only reads the LLM's page and reflects its actions back to the user's PC.

```
User → Luna Web (Svelte) → luna-server (Node) → luna-soul.cjs → kimi-bridge.cjs
                                                              ↓
                                                    Kimi Web / DeepSeek Web (Chrome)
                                                              ↓
                                                    LLM emits JSON tool code blocks
                                                              ↓
                                          Chrome Extension (MAIN world) OR Playwright DOM mirror
                                                              ↓
                                                    luna-soul.cjs parses JSON tool blocks
                                                              ↓
                                                    luna-tools.cjs executes on user's PC
                                                              ↓
                                                    Result is sent back to the LLM chat
```

1. User sends message → `POST /api/chat`
2. `luna-soul.cjs` starts `processMessageStream()`
3. `kimi-bridge.cjs` forwards the message to Kimi Web or DeepSeek Web via Chrome
4. The external LLM streams its response, including JSON code blocks for tool actions
5. The Chrome extension (primary) or Playwright DOM mirror (fallback) detects those code blocks and emits `action_detected` events
6. `luna-soul.cjs` parses the JSON, executes the matching tool via `luna-tools.cjs`
7. The tool result is sent back to the LLM as a follow-up message
8. `luna-chat-routes.js` stores events in session memory
9. SSE endpoint (`/api/chat/stream`) polls session every 100ms
10. `ChatArea.svelte` receives events → updates messages store
11. `MessagesList.svelte` renders components by message type

**Key events:**
- `thinking_start/delta` → ThinkingBubble
- `response_delta` → accumulated in buffer, flushed to AssistantMessage
- `action_detected` / `action_start` / `action_end` → ToolCard (source of truth for tool state)
- `done` → stream ends

---

## Key Patterns

### Response Buffer (v8.3+)
`response_delta` events are buffered in `ChatArea.svelte` instead of rendered immediately. This prevents raw JSON/tool blocks from appearing during streaming. The buffer is flushed when:
- A complete JSON wrapper is detected
- `response_detected` or `done` arrives

### Thinking vs Instant Mode
- **THINKING:** Shows ThinkingBubble while processing
- **INSTANT:** Shows TypingIndicator (dots animation), no thinking text

### Tool Action Format (v2.0 — Delimited Protocol)

The primary protocol uses semantic envelopes:

**Tool call:**
```
<luna_tool_call>
{
  "name": "writeFile",
  "arguments": { "path": "/home/user/project/readme.md", "content": "# Hello" }
}
</luna_tool_call>
```

**Response:**
```
<luna_response>
Your response text here
</luna_response>
```

**Tool result:**
```
<luna_tool_result>
{
  "status": "success",
  "result": "..."
}
</luna_tool_result>
```

The mirror layer emits `luna_tool_call_complete`, `luna-soul.cjs` parses it, and `luna-tools.cjs` executes it on the user's machine. The output is then mirrored back to the LLM chat.

**Legacy fallback:** JSON code blocks are still supported as fallback when `LUNA_TOOL_PROTOCOL=dual` or `legacy`.

### Tool Card State
ToolCard state is driven SOLELY by `action_start` → `action_end` events from the mirror executor. Never rely on DOM mirroring alone for tool status.

### Deduplication
Multiple layers prevent duplicate tool execution:
1. `kimi-bridge.cjs`: `emittedActionCodes` Set per stream (W10-T1: `json_buffer` yields now go through it too, via `buildJsonBufferAction`; the W6-T6 DOM-event key lives in `lib/tool-dedup-key.cjs` and ignores `code` so extension/network-intercept detections of the same action share one key)
2. `luna-soul.cjs`: `executedDomActionHashes` Set per message loop
3. `luna-soul.cjs`: `_executedActionCache` Map per session (global, 5min TTL; cached replays emit `action_start` with `cached:true` — ChatArea suppresses the duplicate card but still applies the replayed `action_end` result)
4. `luna-tools.cjs`: Idempotency pre-check for createLead/createTask
5. `ChatArea.svelte`: `shouldCreateToolCard` (lib/toolCardDedup.js) skips a new card when `cached:true` or when `backendToolId` is already rendered (history-loaded cards carry `backendToolId` too); card ids are `tool-${Date.now()}-${seq}` to avoid same-ms keyed-each collisions

---

## Safety / Permissions

### Allowed without approval
- Read any source file
- Edit frontend Svelte/CSS
- Run `vite build` on luna-web
- Run linters/formatters
- Restart PM2 processes

### Require approval first
- Modifying `luna-soul.cjs` or `kimi-bridge.cjs` (critical backend)
- Installing new npm packages
- Modifying PM2 ecosystem config
- Git operations (commit, push)
- Deleting files outside `luna-web/src/`

---

## Testing Changes

1. Make frontend changes in `packages/kernel/luna-web/src/`
2. Run `cd packages/kernel/luna-web && npm run build`
3. If build succeeds: `pm2 restart luna-server` (or `luna` on Windows)
4. Open browser at `http://localhost:3458`
5. Test the specific feature
6. If broken: check `pm2 logs luna-server` and browser console

**Never commit `dist/` manually** — it is regenerated by `vite build`.

---

## Common Gotchas

- **`dist/` is generated.** Any manual edits are overwritten on build.
- **SSE dedup:** The frontend `processedEventIds` Set prevents duplicate rendering on reconnects. If events look "stale", check the `messageId` filter.
- **Buffer flush:** If assistant text seems delayed, the response buffer may be waiting for a complete JSON block. Check `flushResponseBuffer()` in ChatArea.
- **Chrome Extension:** The extension (`kimi-bridge-interceptor-toolcalls.js`) runs in Chrome's MAIN world. If it fails, the Playwright fallback observer takes over.
- **Mode switching:** `currentMode` store controls thinking vs instant behavior. Always update it via the store, not direct mutation.

---

## When Stuck

- Ask a clarifying question instead of guessing
- Check `pm2 logs` first for backend errors
- Check browser DevTools Network tab for SSE events
- The backup at `backup-luna-web-20260604-193703/` is the last known good version

---

## Refatoração v10.0 (2026-06-08)

### Arquitetura

```
kimi-bridge.cjs (refatorado)
├── bridge-libs/
│   ├── async-mutex.cjs          # Lock FIFO por userId
│   ├── circuit-breaker.cjs      # Estados CLOSED/OPEN/HALF_OPEN
│   ├── process-registry.cjs     # Graceful shutdown (SIGTERM → SIGKILL)
│   ├── config.cjs               # Constantes centralizadas
│   ├── chrome-launcher.cjs      # Chrome .deb com PID específico
│   ├── login-manager.cjs        # Verificação de login
│   ├── dom-extractor.cjs        # Extração DOM (React Fiber removido)
│   ├── bridge-session-manager.cjs # Gerenciamento de sessões
│   └── dom-scripts/
│       ├── poll-dom-structure.js
│       └── detect-ui-state.js
```

### Mudanças críticas

| Antes | Depois |
|-------|--------|
| Chrome deve estar aberto antes do servidor iniciar | **Lazy Connect**: servidor inicia sem Chrome, conecta na 1ª mensagem |
| `pkill -f chrome` mata todos os processos | Kill por PID com graceful shutdown |
| Timeouts infinitos (`timeout: 0`) | Timeouts absolutos de 30s |
| `Semaphore` não existia no construtor | `this.semaphore = new Semaphore(this.maxPages)` — bug crítico corrigido |
| Código monolítico (~6800 linhas) | Classes especializadas em `bridge-libs/` |
| Sem health endpoint | `/api/system/health` com latência, memória, estado do browser |
| Sem circuit breaker | Circuit breaker com 3 estados |

### Bug crítico corrigido

**`this.semaphore` faltava no construtor do `KimiBridge`** — quando nenhuma página existente podia ser reutilizada (porque estava atribuída a outro user), o código caía em `this.semaphore.acquire()` com `undefined`, causando `TypeError`. O generator do `sendMessageStream` lançava o erro, mas como o `for await` no `luna-soul.cjs` estava em um `try/catch` que tratava como bridge error, o stream parecia "travado" sem produzir eventos.

### Lazy Connect

O servidor agora inicia sem depender do Chrome:
1. `lunaSoul.init()` cria `new KimiBridge()` mas NÃO chama `connect()`
2. `_ensureBridgeConnected(userId)` conecta na primeira mensagem
3. Chrome é descoberto automaticamente ou iniciado sob demanda via `ChromeLauncher`

### Teste end-to-end validado

Fluxo testado: `POST /api/chat/session` → `POST /api/chat` → lazy connect → CDP → mensagem enviada → resposta extraída → stream finalizado.

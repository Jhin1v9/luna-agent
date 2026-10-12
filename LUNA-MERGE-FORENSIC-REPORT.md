# LUNA MERGE FORENSIC REPORT

**Data:** 2026-08-16
**Status:** AUDITORIA READ-ONLY — NENHUMA ALTERAÇÃO DE CÓDIGO

---

## 1. Executive Summary

### Objetivo

Produzir um relatório forense suficientemente detalhado para outro agente conseguir arquitetar o MERGE entre:

1. **Response Pipeline Antigo** — que funcionava muito bem
2. **Tool Pipeline V2 Atual** — que agora está funcionando melhor e deve ser preservado

### Descobertas Principais

1. **Repository:** `C:\Users\Abner\Documents\luna-kernel` — branch `main`, commit `1e88ec8`
2. **Modified files:** 11 arquivos modificados (não commitados)
3. **Core files:** `injected.js` (1433 linhas), `kimi-bridge.cjs` (10313 linhas), `luna-soul.cjs` (6399 linhas)
4. **Frontend:** `ChatArea.svelte` (2046 linhas) — 27+ tipos de eventos

### Arquitetura Atual

```
KIMI WEB (Chrome)
    ↓
injected.js (DOM observer, 80ms poll)
    ↓ postMessage
content.js → background.js
    ↓ HTTP POST
kimi-bridge.cjs (sendMessageStream, 38 yield points)
    ↓ yield events
luna-soul.cjs (processMessageStream, ~100 yield points)
    ↓ SSE
api.js → ChatArea.svelte → messages store → Components
```

---

## 2. Repository Reality

| Item | Valor |
|------|-------|
| Repository root | `C:\Users\Abner\Documents\luna-kernel` |
| Branch | `main` |
| Commit | `1e88ec8 luna pc wardilias` |
| Status | Up to date with `origin/main` |
| Modified files | 11 |
| Untracked files | 17 (docs, configs, backups) |

### Modified Files (uncommitted)

| File | Changes |
|------|---------|
| `packages/kernel/AGENTS.md` | Modified |
| `packages/kernel/LUNA_MASTER_PROMPT.md` | Modified |
| `packages/kernel/config/luna-prompt-config.json` | Modified |
| `packages/kernel/kimi-bridge.cjs` | Modified (V2 Authority Gate) |
| `packages/kernel/luna-extension/injected.js` | Modified (V2 Protocol Parser) |
| `packages/kernel/luna-extension/manifest.json` | Modified (v2.10.7) |
| `packages/kernel/luna-soul.cjs` | Modified (UI Event Boundary) |
| `packages/kernel/luna-web/src/components/ChatArea.svelte` | Modified (diagnostic logs) |
| `packages/kernel/luna-web/dist/*` | Rebuilt |

---

## 3. Actual File Tree (Core Files)

```
packages/kernel/
├── luna-extension/
│   ├── injected.js          # DOM observer + V2 Protocol Parser (1433 lines)
│   ├── content.js           # Event transport: injected → background
│   ├── background.js        # Event transport: content → bridge
│   └── manifest.json        # v2.10.7
├── kimi-bridge.cjs          # Chrome automation + DOM extraction (10313 lines)
├── luna-soul.cjs            # Message loop + tool execution + events (6399 lines)
├── luna-server.js           # Express server (port 3458)
├── luna-tools.cjs           # Tool implementations
├── luna-tool-guard.cjs      # Safety guard
├── session-manager.cjs      # Session persistence
├── response-stream-parser.cjs # Stream-aware JSON parsing
├── lib/
│   ├── tool-json-parser.cjs # Unified tolerant JSON parser
│   └── tool-dedup-key.cjs   # Deterministic dedup keys
├── config/
│   └── luna-prompt-config.json # Prompt templates
└── luna-web/
    └── src/
        ├── components/
        │   ├── ChatArea.svelte      # Main orchestrator (2046 lines)
        │   ├── AssistantMessage.svelte # Markdown renderer (707 lines)
        │   ├── ToolCard.svelte       # Tool execution card (715 lines)
        │   ├── ThinkingBubble.svelte # Thinking bubble (207 lines)
        │   └── MessagesList.svelte   # Message list
        ├── api.js            # SSE + HTTP client (660 lines)
        └── stores.js         # Svelte stores (112 lines)
```

---

## 4. Current Architecture

### 4.1 Component Map

| Component | File | Lines | Responsibility |
|-----------|------|-------|----------------|
| **injected.js** | `luna-extension/injected.js` | 1433 | DOM observation, channel detection, V2 protocol parsing, event emission |
| **kimi-bridge.cjs** | `kimi-bridge.cjs` | 10313 | Chrome automation, DOM extraction, stream lifecycle, V2 Authority Gate |
| **luna-soul.cjs** | `luna-soul.cjs` | 6399 | Message loop, tool execution, context building, event routing |
| **ChatArea.svelte** | `luna-web/src/components/ChatArea.svelte` | 2046 | SSE connection, event dispatch, message store, dedup |
| **AssistantMessage.svelte** | `luna-web/src/components/AssistantMessage.svelte` | 707 | Markdown rendering, code highlighting |
| **ToolCard.svelte** | `luna-web/src/components/ToolCard.svelte` | 715 | Tool execution UI, cinema animations |
| **api.js** | `luna-web/src/api.js` | 660 | HTTP API, SSE manager, fallback polling |

### 4.2 Event Flow

```
KIMI WEB
    ↓
injected.js (80ms poll)
    ├─ thinking_start/update/delta
    ├─ stream_state {thinking, response, isStreaming}
    ├─ luna_tool_call_complete (V2)
    ├─ luna_response_complete (V2)
    ├─ tool_call_detected (legacy)
    └─ stream_end
    ↓ postMessage
content.js → background.js
    ↓ HTTP POST
kimi-bridge.cjs (sendMessageStream)
    ├─ action_detected (6 sources)
    ├─ response_delta (9 points)
    ├─ thinking_update/delta
    └─ done
    ↓ yield
luna-soul.cjs (processMessageStream)
    ├─ thinking_start/delta/update
    ├─ response_delta/detected/done
    ├─ action_start/end
    └─ done
    ↓ SSE
ChatArea.svelte → messages store → Components
```

---

## 5. Response Legacy Architecture

### 5.1 How Response Was Captured (Legacy)

**Source:** DOM extraction via `extractResponse()` in injected.js

```
DOM .thinking-container → THINKING
DOM .response-container → RESPONSE
```

**Accumulation:** `responseBuffer` in ChatArea.svelte (APPEND)

**Finalization:** `response_detected` event carries full text (REPLACE)

### 5.2 How Response Works Now

**V2 Protocol:** `<luna_response>...</luna_response>` tags

**Flow:**
1. injected.js detects `<luna_response>` tag
2. Buffers content until `</luna_response>`
3. Emits `luna_response_complete` with full text
4. luna-soul.cjs strips wrapper, yields `response_detected`
5. ChatArea.svelte flushes buffer with full text

### 5.3 What Legacy Did Well

- **Simple extraction:** DOM selectors for thinking/response containers
- **Channel separation:** Thinking container = THINKING, everything else = OUTPUT
- **Streaming:** Incremental `response_delta` for real-time display
- **Fallback:** Multiple extraction strategies (DOM, network, snapshot diff)

### 5.4 What Legacy Did Poorly

- **No semantic classification:** Raw text could contain tool JSON
- **Multiple detection sources:** 6+ sources competing
- **No authority gate:** Legacy and V2 could emit simultaneously
- **Response truncation:** Multiple paths could corrupt response

---

## 6. Current Response Architecture

### 6.1 Response Lifecycle

```
KIMI OUTPUT
    ↓
injected.js: extractResponse()
    ↓
V2 Protocol Parser:
    IDLE → RESPONSE_BUFFERING → RESPONSE_COMPLETE → READY
    ↓
luna_response_complete event
    ↓
kimi-bridge.cjs: response_detected yield
    ↓
luna-soul.cjs:
    luna_response_complete handler
    → strip <luna_response> wrapper
    → yield response_detected
    ↓
ChatArea.svelte:
    response_detected handler
    → flushResponseBuffer(forceText)
    → messages store update
    ↓
AssistantMessage.svelte: render
```

### 6.2 Response Events

| Event | Source | Behavior |
|-------|--------|----------|
| `response_delta` | bridge (9 points) | APPEND to buffer |
| `response_detected` | bridge/soul | REPLACE buffer with full text |
| `response_done` | soul | Final flush + reset |

### 6.3 Response Dedup

| Layer | Mechanism | Scope |
|-------|-----------|-------|
| injected.js | `_lastSentResponse` | Per-poll |
| kimi-bridge.cjs | `emittedResponseHashes` (SHA256) | Per-stream |
| luna-soul.cjs | `v2ResponseHandled` flag | Per-turn |
| ChatArea.svelte | `flushedContentHashes` (djb2) | Per-session |

---

## 7. Current V2 Tool Architecture

### 7.1 Tool Detection Flow

```
KIMI OUTPUT
    ↓
injected.js: detectAndEmit()
    ↓
V2 Protocol Parser:
    IDLE → TOOL_BUFFERING → TOOL_COMPLETE → VALIDATING → READY
    ↓
luna_tool_call_complete event
    ↓
kimi-bridge.cjs:
    V2 Authority Gate check
    → action_detected yield (source: delimited_protocol)
    ↓
luna-soul.cjs:
    luna_tool_call_complete handler
    → dedup (startedToolHashes + _executedActionCache)
    → yield action_start
    → _executeActionAsync (fire-and-forget)
    → eventBus.push(action_end)
    ↓
ChatArea.svelte:
    action_start → create ToolCard
    action_end → complete ToolCard
```

### 7.2 Tool Detection Sources

| Source | Priority | Blocked by V2? |
|--------|----------|----------------|
| `delimited_protocol` | Highest | No (is V2) |
| `dom_mirror` | High | Yes |
| `json_buffer` | Medium | Yes |
| `json_block` | Low | Yes |
| `chrome_extension` | Medium | Yes |
| `state_change` | Low | Yes |

### 7.3 Tool Dedup

| Layer | Mechanism | Scope | TTL |
|-------|-----------|-------|-----|
| injected.js | `_processedToolHashes` (Set) | Per-turn | Turn end |
| injected.js | `_detectedToolKeys` (Map) | Per-bubble | 120s |
| kimi-bridge.cjs | `emittedActionCodes` (SHA256) | Per-stream | Stream end |
| luna-soul.cjs | `startedToolHashes` (Set) | Per-turn | Turn end |
| luna-soul.cjs | `_executedActionCache` (Map) | Per-session | 60s |
| ChatArea.svelte | `shouldCreateToolCard()` | Per-session | Until card created |

### 7.4 V2 Authority Gate

**Location:** kimi-bridge.cjs:8966-8967, injected.js:674-675

**Mechanism:**
- When V2 produces a valid TOOL_CALL → blocks all legacy tool sources
- When V2 produces a valid RESPONSE → blocks all legacy response sources
- Gate resets on new turn

**Checks:**
1. Hard cancel drain (line 9067)
2. action_detected case (line 9298)
3. response_detected case (line 9347)
4. Post-close drain (line 9544)

---

## 8. Full Event Model

### 8.1 Event Types by Layer

#### injected.js → bridge (postMessage)

| Event | Payload |
|-------|---------|
| `thinking_start` | `{thinking, channel: 'THINKING'}` |
| `thinking_update` | `{fullThinking, timestamp, channel: 'THINKING'}` |
| `stream_state` | `{thinking, response, isStreaming, isComplete}` |
| `luna_tool_start` | `{toolId, timestamp}` |
| `luna_tool_complete` | `{toolId, timestamp}` |
| `luna_tool_call_complete` | `{toolCall: {name, arguments}, rescued, protocol, toolId, channel}` |
| `luna_response_complete` | `{response, protocol, channel}` |
| `tool_call_detected` | `{tool, params, rescued}` |
| `stream_end` | `{signal, finalTextLength, finalThinkingLength}` |

#### kimi-bridge.cjs → luna-soul.cjs (yield)

| Event | Count | Description |
|-------|-------|-------------|
| `action_detected` | 6 | Tool call from various sources |
| `response_delta` | 9 | Incremental response text |
| `thinking_update` | 3 | Full thinking replacement |
| `thinking_delta` | 1 | Incremental thinking |
| `thinking_start` | 1 | Thinking bubble creation |
| `response_detected` | 1 | Complete response |
| `done` | 1 | Turn complete |
| `waiting` | 2 | Heartbeat |
| `can_steer` | 1 | Steering available |
| `context_limit` | 1 | Context limit hit |

#### luna-soul.cjs → ChatArea.svelte (yield)

| Event | Count | Description |
|-------|-------|-------------|
| `thinking_start` | 3 | Thinking bubble creation |
| `thinking_delta` | 3 | Incremental thinking |
| `thinking_update` | 1 | Full thinking replacement |
| `response_delta` | 1 | Incremental response |
| `response_detected` | 4 | Complete response |
| `response_done` | 3 | Response finalization |
| `action_start` | 7 | Tool execution begin |
| `action_end` | 3+ | Tool execution end |
| `done` | ~24 | Terminal events |
| `error` | 14 | Errors |
| `warning` | 10 | Warnings |
| `system` | 10 | System messages |
| `mode_detected` | 1 | Mode detection |
| `login_required` | 2 | Login needed |

---

## 9. Response Pipeline Trace

### 9.1 Case A: Simple Response (no Tool)

```
1. injected.js: extractResponse() → "Olá mundo"
2. injected.js: hasProtocolDelimiter? NO
3. injected.js: hasPartialDelimiter? NO
4. injected.js: emitStreamState(thinking, "Olá mundo", true)
5. kimi-bridge.cjs: state_change → response_delta yield
6. luna-soul.cjs: response_delta → fullResponse += cleanText → yield
7. ChatArea.svelte: responseBuffer += deltaText → flush
8. AssistantMessage.svelte: render markdown
```

### 9.2 Case B: V2 Response

```
1. injected.js: extractResponse() → "<luna_response>Olá mundo</luna_response>"
2. injected.js: hasProtocolDelimiter? YES (includes RESPONSE_OPEN)
3. injected.js: Protocol Parser: IDLE → RESPONSE_BUFFERING
4. injected.js: findProtocolClose() → found
5. injected.js: RESPONSE_COMPLETE → READY
6. injected.js: queueEvent('luna_response_complete', {response: "Olá mundo"})
7. kimi-bridge.cjs: luna_response_complete → response_detected yield
8. luna-soul.cjs: luna_response_complete handler → strip wrapper → yield response_detected
9. ChatArea.svelte: flushResponseBuffer("Olá mundo") → force replace
10. AssistantMessage.svelte: render markdown
```

### 9.3 Case C: V2 Tool → Response

```
1. injected.js: extractResponse() → "<luna_tool_call>..."
2. injected.js: Protocol Parser: IDLE → TOOL_BUFFERING → TOOL_COMPLETE → READY
3. injected.js: queueEvent('luna_tool_call_complete', {toolCall: {name, arguments}})
4. kimi-bridge.cjs: V2 Authority Gate active → action_detected yield
5. luna-soul.cjs: luna_tool_call_complete → dedup → yield action_start
6. luna-soul.cjs: _executeActionAsync() → eventBus.push(action_end)
7. luna-soul.cjs: buildToolResultPrompt() → send to Kimi
8. Kimi: produces response
9. injected.js: extractResponse() → "<luna_response>..."
10. (same as Case B)
```

---

## 10. Tool Pipeline Trace

### 10.1 V2 Tool Detection

```
1. injected.js: DOM poll (80ms)
2. injected.js: extractResponse() → "<luna_tool_call>{"name":"writeFile",...}</luna_tool_call>"
3. injected.js: hasProtocolDelimiter? YES
4. injected.js: Protocol Parser: IDLE → TOOL_BUFFERING
5. injected.js: _protocolBuffer accumulates content
6. injected.js: findProtocolClose("</luna_tool_call>") → found
7. injected.js: TOOL_COMPLETE → VALIDATING
8. injected.js: JSON.parse(_protocolBuffer) → success (or miniJsonRepair fallback)
9. injected.js: Validate name + arguments
10. injected.js: Dedup check (_processedToolHashes)
11. injected.js: READY → emit luna_tool_call_complete
12. injected.js: Set _v2AuthorityActive = true, _v2AuthorityType = 'tool'
13. kimi-bridge.cjs: V2 Authority Gate → block legacy tools
14. kimi-bridge.cjs: yield action_detected {source: 'delimited_protocol'}
15. luna-soul.cjs: dedup (startedToolHashes + _executedActionCache)
16. luna-soul.cjs: yield action_start
17. luna-soul.cjs: _executeActionAsync()
18. luna-soul.cjs: _handleAction() → tool execution
19. luna-soul.cjs: eventBus.push(action_end)
20. ChatArea.svelte: action_start → create ToolCard
21. ChatArea.svelte: action_end → complete ToolCard
```

### 10.2 Legacy Tool Detection (blocked by V2)

```
1. injected.js: detectJsonBlocks() → finds JSON code block
2. injected.js: isV2BlockingLegacy('tool')? YES → BLOCKED
3. (no event emitted)
```

---

## 11. Response + Tool Interaction

### 11.1 Response → Tool → Response

```
1. Kimi: thinking → tool call
2. injected.js: TOOL_BUFFERING → TOOL_COMPLETE
3. kimi-bridge: action_detected
4. luna-soul: action_start → execute → action_end
5. luna-soul: buildToolResultPrompt() → send to Kimi
6. Kimi: thinking → response
7. injected.js: RESPONSE_BUFFERING → RESPONSE_COMPLETE
8. kimi-bridge: response_detected
9. luna-soul: response_detected → yield
10. ChatArea: flush response
```

### 11.2 Potential Issues

1. **V2 Authority Gate reset:** Must reset on new turn to allow legacy fallback
2. **Response truncation:** Multiple response_delta sources could corrupt
3. **Tool Result duplication:** buildToolResultPrompt adds LUNA-MIRROR + stdout

---

## 12. 996 → 462 Forensics

### Observed in logs:

```
RAW_OUTPUT len=996
TOOL_COMPLETE bufferSize=462
```

### Possible causes:

1. **Wrapper stripping:** `<luna_tool_call>` (15 chars) + `</luna_tool_call>` (16 chars) = 31 chars
2. **JSON extraction:** Only JSON content between tags is buffered
3. **Whitespace:** Leading/trailing whitespace trimmed

### Investigation needed:

- Capture exact raw output and buffer content
- Compare character by character
- Identify where 534 chars are lost

---

## 13. Synchronization / Timing Analysis

### 13.1 Polling Architecture

| Timer | Interval | Purpose |
|-------|----------|---------|
| `pollTimer` | 80ms | Primary DOM poll |
| `heartbeatTimer` | 600ms | ForceResync when streaming |
| `MutationObserver` | Immediate | DOM change detection |
| `BATCH_MS` | 40ms | Event batch coalescing |

### 13.2 Potential Timing Issues

1. **forceResync:** Heartbeat re-emits stale content
2. **Partial delimiter:** First chunks emitted before full delimiter detected
3. **Response truncation:** Multiple sources emitting simultaneously
4. **Tool Result delay:** ~1 minute between ACTION_END and KIMI output

### 13.3 Known Delays

| Phase | Typical Duration |
|-------|------------------|
| Kimi thinking | 5-35 seconds |
| Tool execution | <1 second |
| Tool Result → Kimi | Unknown (needs instrumentation)
| Kimi → next output | 5-35 seconds |

---

## 14. SSE Analysis

### 14.1 Server → Browser

```
luna-soul.cjs (yield)
    ↓
luna-chat-routes.js (SSE endpoint)
    ↓
res.write(`data: ${JSON.stringify(event)}\n\n`)
    ↓
EventSource (api.js)
    ↓
ChatArea.handleEvent()
```

### 14.2 Event Serialization

- Events are JSON.stringify'd
- Sent as SSE `data:` lines
- Parsed by SSEManager.onmessage
- Forwarded to ChatArea.handleEvent

### 14.3 Fallback Polling

- Activates on SSE error
- Polls `/api/chat/session/{id}/messages` every 2s
- Events tagged with `source: 'fallback'`
- Ignored by ChatArea while actively streaming

---

## 15. Frontend Analysis

### 15.1 ChatArea.svelte (2046 lines)

**Role:** Central orchestrator

**Key mechanisms:**
- `responseBuffer` — accumulates response_delta tokens
- `flushResponseBuffer()` — strips tool blocks, deduplicates, flushes to store
- `stripToolBlocksFromBuffer()` — removes JSON tool wrappers
- `hasIncompleteJsonBlock()` — prevents premature flush
- `shouldCreateToolCard()` — deduplicates tool cards
- `pendingToolCount` — tracks active tools

### 15.2 AssistantMessage.svelte (707 lines)

**Role:** Markdown renderer

**Key mechanisms:**
- `lunaMarked.parse()` — markdown to HTML
- `highlight.js` — code syntax highlighting
- `scheduleRender()` — debounced render (120ms during streaming)
- Personality detection — code/search/action/table flags

### 15.3 ToolCard.svelte (715 lines)

**Role:** Tool execution card

**Key mechanisms:**
- Status machine: running → completed/failed
- Cinema animations per tool type
- Confirmation gate for destructive operations
- Live output streaming

---

## 16. Markdown Analysis

### 16.1 Library

- **marked** (via `lunaMarked` module-level singleton)
- Custom renderer for code blocks and inline code
- highlight.js for syntax highlighting

### 16.2 Rendering Pipeline

```
response text
    ↓
lunaMarked.parse()
    ↓
custom code renderer → .code-block-wrapper + copy button
custom codespan renderer → .inline-code
    ↓
table wrapper injection
    ↓
innerHTML set
    ↓
hljs.highlightElement() for all pre code blocks
```

### 16.3 Potential Issues

1. **Streaming render:** Debounced at 120ms — could miss fast updates
2. **Code highlighting:** Applied after innerHTML — brief flash of unhighlighted code
3. **Table rendering:** Custom wrapper injection could break complex tables

---

## 17. Deduplication Analysis

### 17.1 Complete Dedup Chain

| Layer | Location | Mechanism | Scope |
|-------|----------|-----------|-------|
| injected.js | `_processedToolHashes` | Set of content hashes | Per-turn |
| injected.js | `_detectedToolKeys` | Map<key, DOMNode> | Per-bubble |
| injected.js | `_detectedResponseKeys` | Map<hash, DOMNode> | Per-bubble |
| injected.js | `_lastSentResponse` | String comparison | Per-poll |
| kimi-bridge.cjs | `emittedActionCodes` | SHA256 Set | Per-stream |
| kimi-bridge.cjs | `emittedResponseHashes` | SHA256 Set | Per-stream |
| kimi-bridge.cjs | V2 Authority Gate | Boolean flag | Per-stream |
| luna-soul.cjs | `startedToolHashes` | SHA256 Set | Per-turn |
| luna-soul.cjs | `_executedActionCache` | Map with TTL | Per-session |
| luna-soul.cjs | `v2ResponseHandled` | Boolean flag | Per-turn |
| ChatArea.svelte | `flushedContentHashes` | djb2 hash Set | Per-session |
| ChatArea.svelte | `shouldCreateToolCard()` | Backend ID check | Per-session |
| ChatArea.svelte | `toolInstanceMap` | Map<backend, frontend> | Per-session |

### 17.2 Potential Dedup Gaps

1. **Cross-turn:** `_executedActionCache` has 60s TTL — could miss late duplicates
2. **Response hash:** SHA256 of full text — large responses expensive to hash
3. **Tool card dedup:** Relies on `backendToolId` — if bridge doesn't provide, falls back to name

---

## 18. Cancellation / Drain Analysis

### 18.1 Hard Cancel

**Trigger:** New message sent while streaming

**Flow:**
1. `stopConsuming = true`
2. Hard cancel drain: yield remaining `action_detected`
3. Throw `STREAM_CANCELLED`
4. finally: clear session state

### 18.2 Soft Cancel

**Trigger:** User clicks stop button

**Flow:**
1. `session.softCancelRequested = true`
2. Soft cancel drain: wait for events to settle
3. `cancelStream(userId, true)` — stops Kimi, drains queue
4. Continue until no new events + Kimi stopped

### 18.3 Post-Close Drain

**Trigger:** Completion consensus reached

**Flow:**
1. 2-second timeout
2. Only `action_detected` honored
3. All other events discarded
4. V2 Authority Gate applied

---

## 19. Legacy Components

### 19.1 Legacy Detection (injected.js)

| Component | Status | Description |
|-----------|--------|-------------|
| `detectJsonBlocks()` | Active (gated) | JSON code block scanning |
| `emitFinalToolCalls()` | Active (gated) | Post-stream tool emission |
| `tool_response_detected` | Active (gated) | Legacy response detection |
| `splitThinkingAndResponse()` | Active | Heuristic fallback |

### 19.2 Legacy Detection (kimi-bridge.cjs)

| Component | Status | Description |
|-----------|--------|-------------|
| `json_buffer` | Active (gated) | JSON accumulation buffer |
| `dom_mirror` | Active (gated) | DOM structure extraction |
| `json_block` | Active (gated) | Late-stage JSON scanning |
| `state_change` | Active (gated) | Poller-based detection |

### 19.3 Legacy Response (luna-soul.cjs)

| Component | Status | Description |
|-----------|--------|-------------|
| `parseKimiResponse()` | Active | Multi-strategy JSON parser |
| `parseTagResponse()` | Active | Tag-based parser |
| `_tryExtractRawToolJson()` | Active | Backstop parser |

---

## 20. Components Working Correctly

1. **V2 Protocol Parser** — Detects `<luna_tool_call>` and `<luna_response>` correctly
2. **Channel Detection** — THINKING vs OUTPUT separation works
3. **Tool Execution** — Tools execute correctly via V2 path
4. **V2 Authority Gate** — Blocks legacy when V2 active
5. **Tool Dedup** — Multiple layers prevent duplicate execution
6. **Thinking Extraction** — DOM-based extraction works correctly
7. **Markdown Rendering** — marked + highlight.js works correctly
8. **SSE Transport** — Events delivered reliably
9. **Fallback Polling** — Works when SSE is down

---

## 21. Components Broken

1. **Response Truncation** — Response appears truncated in UI
2. **Tool Result Duplication** — Multiple representations sent to Kimi
3. **Context Bloat** — Full context rebuilt every turn
4. **Partial Delimiter Leaking** — First chunks emitted as response_delta
5. **996 → 462** — Unknown where 534 chars are lost
6. **Tool Result Delay** — ~1 minute between execution and Kimi output

---

## 22. Components That Must Be Preserved

1. **V2 Protocol Parser** — Core of new architecture
2. **Channel Detection** — THINKING/OUTPUT separation
3. **V2 Authority Gate** — Prevents legacy/V2 conflict
4. **Tool Dedup Chain** — Prevents duplicate execution
5. **Event Batch Coalescing** — 40ms batching prevents UI thrashing
6. **SSE Fallback Polling** — Graceful degradation

---

## 23. Components That Can Be Removed Later

1. **Legacy JSON detection** — After V2 proven stable
2. **`dom_mirror` source** — After V2 covers all cases
3. **`json_buffer` source** — After V2 covers all cases
4. **`splitThinkingAndResponse()`** — After DOM extraction proven
5. **`processedEventIds`** — Currently disabled, can be removed
6. **Legacy `response_detected` path** — After V2 response proven

---

## 24. Components That Can Be Merged

1. **Response events:** `response_delta` + `response_detected` + `response_done` → unified lifecycle
2. **Tool events:** `action_start` + `action_end` → unified lifecycle
3. **Dedup mechanisms:** Consolidate 13 mechanisms into fewer
4. **Context building:** Single builder instead of multiple paths

---

## 25. Files Likely To Change

| File | Reason |
|------|--------|
| `injected.js` | Protocol parser refinement |
| `kimi-bridge.cjs` | Response pipeline, dedup consolidation |
| `luna-soul.cjs` | Tool Result, context building, event routing |
| `ChatArea.svelte` | Response handling, UI boundary |
| `luna-prompt-config.json` | Prompt templates |

---

## 26. Files That Should NOT Change

| File | Reason |
|------|--------|
| `luna-tools.cjs` | Tool implementations are stable |
| `luna-tool-guard.cjs` | Safety mechanisms are critical |
| `session-manager.cjs` | Session persistence is stable |
| `api.js` | SSE/HTTP client is stable |
| `stores.js` | Svelte stores are stable |
| `AssistantMessage.svelte` | Markdown renderer is working |
| `ToolCard.svelte` | Tool UI is working |
| `ThinkingBubble.svelte` | Thinking UI is working |

---

## 27. Risks

1. **Legacy removal:** Could break fallback for non-V2 providers
2. **Response consolidation:** Could break streaming display
3. **Dedup consolidation:** Could allow duplicates or miss events
4. **Context reduction:** Could lose important context for Kimi
5. **Tool Result simplification:** Could break Kimi's understanding

---

## 28. Unknowns

1. **996 → 462:** Where exactly are 534 chars lost?
2. **Response truncation:** Which layer truncates the response?
3. **Tool Result delay:** What causes ~1 minute delay?
4. **Context bloat:** How much context does Kimi actually need?
5. **Legacy necessity:** Which providers need legacy fallback?

---

## 29. Evidence Index

| Claim | File | Line | Evidence |
|-------|------|------|----------|
| V2 Protocol Parser exists | injected.js | 644-660 | Protocol states defined |
| Channel detection works | injected.js | 879-899 | findThinkingContainer + extractThinking |
| V2 Authority Gate exists | kimi-bridge.cjs | 8966-8967 | v2AuthorityActive flag |
| Tool dedup chain exists | luna-soul.cjs | 2752 | startedToolHashes Set |
| Response buffer exists | ChatArea.svelte | 40 | responseBuffer string |
| Tool card dedup exists | ChatArea.svelte | 630 | shouldCreateToolCard() |
| Markdown renderer exists | AssistantMessage.svelte | 26 | lunaMarked singleton |
| SSE fallback exists | api.js | 52-89 | Fallback polling |

---

## 30. Recommended Merge Strategy

### Phase 1: Response Pipeline Unification

1. Define single Response lifecycle: START → DELTA* → COMPLETE → DONE
2. Consolidate `response_delta` + `response_detected` + `response_done`
3. Ensure COMPLETE carries authoritative full text
4. Test: simple response, long response, markdown response

### Phase 2: Tool Result Canonicalization

1. Define single Tool Result structure
2. Remove LUNA-MIRROR duplication
3. Remove stdout duplication
4. Test: tool execution, result feedback

### Phase 3: Context Reduction

1. Define minimal context per turn type
2. Remove repeated AGENTS/Brain/Workspace
3. Test: first turn, tool turn, follow-up turn

### Phase 4: Legacy Quarantine

1. Keep legacy code but disable by default
2. Enable only for non-V2 providers
3. Test: V2 provider, legacy provider

### Phase 5: Dedup Consolidation

1. Reduce 13 mechanisms to essential set
2. Prove no duplicates with reduced set
3. Test: rapid tool calls, reconnections

---

## 31. Appendix: Key File Locations

### Core Backend

| File | Path | Lines |
|------|------|-------|
| injected.js | `packages/kernel/luna-extension/injected.js` | 1433 |
| kimi-bridge.cjs | `packages/kernel/kimi-bridge.cjs` | 10313 |
| luna-soul.cjs | `packages/kernel/luna-soul.cjs` | 6399 |
| luna-server.js | `packages/kernel/luna-server.js` | ~500 |
| luna-tools.cjs | `packages/kernel/luna-tools.cjs` | ~2000 |

### Core Frontend

| File | Path | Lines |
|------|------|-------|
| ChatArea.svelte | `packages/kernel/luna-web/src/components/ChatArea.svelte` | 2046 |
| AssistantMessage.svelte | `packages/kernel/luna-web/src/components/AssistantMessage.svelte` | 707 |
| ToolCard.svelte | `packages/kernel/luna-web/src/components/ToolCard.svelte` | 715 |
| ThinkingBubble.svelte | `packages/kernel/luna-web/src/components/ThinkingBubble.svelte` | 207 |
| api.js | `packages/kernel/luna-web/src/api.js` | 660 |
| stores.js | `packages/kernel/luna-web/src/stores.js` | 112 |

### Libraries

| File | Path | Lines |
|------|------|-------|
| tool-json-parser.cjs | `packages/kernel/lib/tool-json-parser.cjs` | ~200 |
| tool-dedup-key.cjs | `packages/kernel/lib/tool-dedup-key.cjs` | ~50 |
| response-stream-parser.cjs | `packages/kernel/response-stream-parser.cjs` | ~300 |

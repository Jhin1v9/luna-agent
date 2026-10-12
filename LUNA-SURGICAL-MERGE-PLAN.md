# LUNA — SURGICAL MERGE PLAN

**Data:** 2026-08-16
**Status:** PLANO — NENHUMA ALTERAÇÃO DE CÓDIGO

---

## 1. Executive Summary

### Objetivo

Restaurar o Response Pipeline estável do commit `1e88ec8` e preservar apenas as partes do V2 necessárias para o novo Tool Pipeline.

### Princípio

> **Response antigo + Tools V2.**

Não: Response V2 + Tools V2.

### Abordagem

O menor diff funcional possível. Não refatoração estética. Não nova abstração.

---

## 2. Stable Architecture — `1e88ec8`

### Response Pipeline (FUNCIONAVA)

```
KIMI → injected.js → kimi-bridge.cjs → luna-soul.cjs → ChatArea → AssistantMessage
```

**Eventos:**
- `response_delta` → APPEND
- `response_detected` → REPLACE
- `response_done` → FINALIZE

**Funções-chave:**
- `extractResponse()` — DOM extraction
- `_stripJsonResponseWrapper()` — Remove JSON wrappers
- `parseKimiResponse()` — Multi-strategy JSON parser

### Tool Pipeline (LEGACY JSON)

```
KIMI → injected.js → kimi-bridge.cjs → luna-soul.cjs → ChatArea → ToolCard
```

**Eventos:**
- `action_detected` → dedup → `action_start`
- `_executeActionAsync()` → `action_end`

**Fontes:**
- `json_buffer` — JSON accumulation buffer
- `dom_mirror` — DOM structure extraction
- `json_block` — Late-stage scanning

---

## 3. Current Architecture (Working Directory)

### V2 Protocol Parser (injected.js)

**Adicionado:**
- Protocol constants (`TOOL_OPEN`, `TOOL_CLOSE`, `RESPONSE_OPEN`, `RESPONSE_CLOSE`)
- Protocol state machine (`IDLE → TOOL_BUFFERING → TOOL_COMPLETE → VALIDATING → READY`)
- Partial delimiter detection
- V2 Authority Gate (`_v2AuthorityActive`, `_v2AuthorityType`)
- Tool dedup (`_processedToolHashes`)
- `miniJsonRepair()` integration

### V2 Authority Gate (kimi-bridge.cjs)

**Adicionado:**
- `v2AuthorityActive` flag
- `v2AuthorityType` flag
- Gate checks at 4 points (hard cancel, action_detected, response_detected, post-close drain)

### V2 Handlers (luna-soul.cjs)

**Adicionado:**
- `luna_tool_call_complete` handler
- `luna_response_complete` handler
- `luna_unknown_output` handler
- `v2ResponseHandled` flag
- `v2ResponseComplete` flag
- UI Event Boundary (`mapRuntimeEventToUiEvent`)
- Watchdog timer

### Prompt Changes (luna-soul.cjs)

**Alterado:**
- `DEFAULT_TOOL_RESULT_PROMPT` — De texto verbose para `<luna_tool_result>` JSON
- `DEFAULT_MINI_REMINDER` — De instruções legacy para protocolo V2

---

## 4. Exact Differences

### injected.js

| Change | Lines | Type | Purpose |
|--------|-------|------|---------|
| BUILD_SENTINEL | 10-14 | ADD | Debug sentinel |
| V2 Protocol Parser | 635-735 | ADD | Protocol state machine |
| V2 Authority Gate | 808-812 | ADD | Block legacy when V2 active |
| Channel logging | 916-917 | ADD | `[PROTOCOL][CHANNEL]` logs |
| Response delimiter check | 945-997 | MODIFY | Check for protocol tags before emit |
| V2 Protocol Parser body | 998-1185 | ADD | Full protocol parser |

### kimi-bridge.cjs

| Change | Lines | Type | Purpose |
|--------|-------|------|---------|
| V2 Authority Gate | 8966-8967 | ADD | Gate flags |
| Gate check: hard cancel | 9067-9070 | ADD | Block legacy tools |
| Gate check: action_detected | 9296-9301 | ADD | Block legacy tools |
| Gate check: response_detected | 9346-9349 | ADD | Block legacy responses |
| Gate check: post-close drain | 9544-9547 | ADD | Block legacy tools |

### luna-soul.cjs

| Change | Lines | Type | Purpose |
|--------|-------|------|---------|
| PROTOCOL_MODE flag | 14-17 | ADD | Feature flag |
| DEFAULT_TOOL_RESULT_PROMPT | 155-165 | MODIFY | V2 format |
| DEFAULT_MINI_REMINDER | 166-170 | MODIFY | V2 instructions |
| _tryExtractRawToolJson skip | 473-483 | ADD | Skip V2 delimiters |
| V2 response flags | 2739-2750 | ADD | v2ResponseHandled, v2ResponseComplete |
| UI Event Boundary | 2751-2780 | ADD | mapRuntimeEventToUiEvent |
| Watchdog timer | 2781-2790 | ADD | Stream stall detection |
| response_delta filter | 2855-2858 | MODIFY | Apply UI Event Mapper |
| luna_tool_call_complete handler | 3001-3061 | ADD | V2 tool handling |
| luna_response_complete handler | 3064-3096 | ADD | V2 response handling |
| luna_unknown_output handler | 3098-3110 | ADD | V2 unknown handling |

### ChatArea.svelte

| Change | Lines | Type | Purpose |
|--------|-------|------|---------|
| UI_RESPONSE_TRACE logs | 139-241 | ADD | Diagnostic logs |

---

## 5. Response Pipeline to Restore

### From `1e88ec8`

1. **`response_delta` handling** — APPEND to buffer
2. **`response_detected` handling** — REPLACE buffer with full text
3. **`response_done` handling** — Final flush
4. **`_stripJsonResponseWrapper()`** — Remove JSON wrappers
5. **`parseKimiResponse()`** — Multi-strategy JSON parser

### What to KEEP from V2

1. **Channel detection** — THINKING/OUTPUT separation (already in `1e88ec8`)
2. **`_tryExtractRawToolJson` skip** — Don't parse V2 delimiters as legacy JSON

### What to REVERT

1. **`DEFAULT_TOOL_RESULT_PROMPT`** — Revert to verbose text format
2. **`DEFAULT_MINI_REMINDER`** — Revert to legacy instructions
3. **`v2ResponseHandled` flag** — Remove (not needed if V2 response not used)
4. **`v2ResponseComplete` flag** — Remove
5. **`luna_response_complete` handler** — Remove (use legacy response path)

---

## 6. Tool V2 Pipeline to Preserve

### KEEP

1. **V2 Protocol Parser** (injected.js) — `<luna_tool_call>` detection
2. **V2 Authority Gate** (kimi-bridge.cjs) — Block legacy when V2 active
3. **`luna_tool_call_complete` handler** (luna-soul.cjs) — V2 tool execution
4. **Tool dedup** (`_processedToolHashes`, `startedToolHashes`)
5. **`miniJsonRepair()`** — JSON repair for malformed tool calls
6. **Partial delimiter detection** — Handle chunked delimiters
7. **Channel logging** — `[PROTOCOL][CHANNEL]` for debugging

### MODIFY

1. **V2 Authority Gate** — Only block legacy TOOLS, not responses
2. **Response handling** — Use legacy path for responses

### REMOVE

1. **`luna_response_complete` handler** — Use legacy response path
2. **`v2ResponseHandled` flag** — Not needed
3. **`v2ResponseComplete` flag** — Not needed
4. **UI Event Boundary** — Not needed (legacy response works fine)

---

## 7. Components to Remove

| Component | File | Reason |
|-----------|------|--------|
| `v2ResponseHandled` | luna-soul.cjs | Not needed if using legacy response |
| `v2ResponseComplete` | luna-soul.cjs | Not needed if using legacy response |
| `luna_response_complete` handler | luna-soul.cjs | Use legacy response path |
| UI Event Boundary | luna-soul.cjs | Not needed |
| Watchdog timer | luna-soul.cjs | Not needed |
| `DEFAULT_TOOL_RESULT_PROMPT` V2 format | luna-soul.cjs | Revert to verbose |
| `DEFAULT_MINI_REMINDER` V2 format | luna-soul.cjs | Revert to legacy |

---

## 8. Components to Keep

| Component | File | Reason |
|-----------|------|--------|
| V2 Protocol Parser | injected.js | Tool detection works |
| V2 Authority Gate (tools only) | kimi-bridge.cjs | Block legacy tools when V2 active |
| `luna_tool_call_complete` handler | luna-soul.cjs | V2 tool execution |
| Tool dedup | injected.js, luna-soul.cjs | Prevent duplicates |
| `miniJsonRepair()` | injected.js | JSON repair |
| Partial delimiter detection | injected.js | Handle chunked delimiters |
| Channel detection | injected.js | THINKING/OUTPUT separation |
| `_tryExtractRawToolJson` skip | luna-soul.cjs | Don't parse V2 delimiters |
| Legacy response pipeline | luna-soul.cjs | Works correctly |
| Legacy response pipeline | ChatArea.svelte | Works correctly |

---

## 9. Components to Modify

| Component | File | Change |
|-----------|------|--------|
| V2 Authority Gate | kimi-bridge.cjs | Only block tools, not responses |
| `DEFAULT_TOOL_RESULT_PROMPT` | luna-soul.cjs | Revert to verbose format |
| `DEFAULT_MINI_REMINDER` | luna-soul.cjs | Revert to legacy instructions |
| Response handling | luna-soul.cjs | Remove V2 response flags |

---

## 10. Exact Files

| File | Action | Lines Changed |
|------|--------|---------------|
| `injected.js` | KEEP V2 Protocol Parser | ~400 lines |
| `kimi-bridge.cjs` | MODIFY V2 Gate (tools only) | ~20 lines |
| `luna-soul.cjs` | REVERT Response, KEEP Tool | ~100 lines |
| `ChatArea.svelte` | KEEP diagnostic logs | ~20 lines |
| `LUNA_MASTER_PROMPT.md` | REVERT to stable | ~200 lines |
| `config/luna-prompt-config.json` | REVERT to stable | ~15 lines |

---

## 11. Exact Functions

### KEEP

| Function | File | Purpose |
|----------|------|---------|
| `findProtocolStart()` | injected.js | V2 delimiter detection |
| `findPartialMatch()` | injected.js | Partial delimiter handling |
| `findProtocolClose()` | injected.js | Close tag detection |
| `miniJsonRepair()` | injected.js | JSON repair |
| `isV2BlockingLegacy()` | injected.js | V2 Authority Gate |
| `emitFinalToolCalls()` | injected.js | Legacy tool emission (gated) |
| `_tryExtractRawToolJson()` | luna-soul.cjs | Skip V2 delimiters |

### REVERT

| Function | File | Change |
|----------|------|--------|
| `DEFAULT_TOOL_RESULT_PROMPT` | luna-soul.cjs | Revert to verbose format |
| `DEFAULT_MINI_REMINDER` | luna-soul.cjs | Revert to legacy instructions |

### REMOVE

| Function | File | Reason |
|----------|------|--------|
| `luna_response_complete` handler | luna-soul.cjs | Use legacy response |
| `v2ResponseHandled` | luna-soul.cjs | Not needed |
| `v2ResponseComplete` | luna-soul.cjs | Not needed |
| `mapRuntimeEventToUiEvent` | luna-soul.cjs | Not needed |
| Watchdog timer | luna-soul.cjs | Not needed |

---

## 12. Exact Code Regions / Line Ranges

### injected.js

| Region | Lines | Action |
|--------|-------|--------|
| BUILD_SENTINEL | 10-14 | KEEP |
| V2 Protocol constants | 644-647 | KEEP |
| V2 Protocol states | 650-660 | KEEP |
| V2 Protocol variables | 662-676 | KEEP |
| `resetProtocol()` | 677-684 | KEEP |
| `resetTurnProtocolState()` | 686-692 | KEEP |
| `isV2BlockingLegacy()` | 695-701 | KEEP |
| `generateToolId()` | 703-705 | KEEP |
| `findProtocolStart()` | 708-724 | KEEP |
| `findPartialMatch()` | 727-735 | KEEP |
| `findProtocolClose()` | 738-740 | KEEP |
| V2 Authority Gate in `emitFinalToolCalls` | 812-815 | KEEP |
| Channel logging | 916-917 | KEEP |
| Response delimiter check | 945-997 | KEEP |
| V2 Protocol Parser body | 998-1185 | KEEP |

### kimi-bridge.cjs

| Region | Lines | Action |
|--------|-------|--------|
| V2 Authority flags | 8966-8967 | KEEP |
| Gate check: hard cancel | 9067-9070 | KEEP (tools only) |
| Gate check: action_detected | 9296-9301 | KEEP (tools only) |
| Gate check: response_detected | 9346-9349 | **REMOVE** (allow legacy responses) |
| Gate check: post-close drain | 9544-9547 | KEEP (tools only) |

### luna-soul.cjs

| Region | Lines | Action |
|--------|-------|--------|
| PROTOCOL_MODE flag | 14-17 | KEEP |
| DEFAULT_TOOL_RESULT_PROMPT | 155-165 | **REVERT** to verbose |
| DEFAULT_MINI_REMINDER | 166-170 | **REVERT** to legacy |
| _tryExtractRawToolJson skip | 473-483 | KEEP |
| V2 response flags | 2739-2750 | **REMOVE** |
| UI Event Boundary | 2751-2780 | **REMOVE** |
| Watchdog timer | 2781-2790 | **REMOVE** |
| response_delta filter | 2855-2858 | **REVERT** (remove filter) |
| luna_tool_call_complete handler | 3001-3061 | KEEP |
| luna_response_complete handler | 3064-3096 | **REMOVE** |
| luna_unknown_output handler | 3098-3110 | KEEP |

---

## 13. Data Flow

### Response Flow (Target)

```
KIMI → injected.js (extractResponse) → kimi-bridge.cjs (response_delta) → luna-soul.cjs (response_delta) → ChatArea (buffer) → AssistantMessage
```

### Tool Flow (Target)

```
KIMI → injected.js (V2 Protocol Parser) → kimi-bridge.cjs (V2 Gate) → luna-soul.cjs (luna_tool_call_complete) → _executeActionAsync → ToolCard
```

### Thinking Flow (Target)

```
KIMI → injected.js (extractThinking) → kimi-bridge.cjs (thinking_update) → luna-soul.cjs (thinking_update) → ChatArea (ThinkingBubble)
```

---

## 14. Event Flow

### Response Events

| Event | Source | Behavior |
|-------|--------|----------|
| `response_delta` | bridge | APPEND to buffer |
| `response_detected` | bridge | REPLACE buffer |
| `response_done` | soul | Final flush |

### Tool Events

| Event | Source | Behavior |
|-------|--------|----------|
| `luna_tool_call_complete` | injected.js | V2 tool detected |
| `action_start` | soul | Tool execution begin |
| `action_end` | soul (eventBus) | Tool execution end |

### Thinking Events

| Event | Source | Behavior |
|-------|--------|----------|
| `thinking_start` | injected.js | Thinking begin |
| `thinking_update` | injected.js | Full thinking replacement |
| `thinking_delta` | injected.js | Incremental thinking |

---

## 15. 996 → 462 Investigation

### Hypothesis

The 996 chars include:
- `<luna_tool_call>` (15 chars)
- JSON content (462 chars)
- `</luna_tool_call>` (16 chars)
- Additional text (403 chars) — possibly thinking or response content

The 462 chars are likely just the JSON content between the tags.

### Investigation Needed

1. Capture exact raw output from injected.js
2. Capture exact buffer content in V2 Protocol Parser
3. Compare character by character
4. Identify where 534 chars are lost

### Likely Resolution

The 534 chars are likely:
- Protocol tags (31 chars)
- Additional thinking/response text (503 chars)

This is expected behavior — the protocol parser extracts only the JSON content between tags.

---

## 16. Delay Investigation

### Observed

```
ACTION_END → ~1 minute → KIMI output resumes
```

### Possible Causes

1. **Processing lock:** `session.processing` wait
2. **Stream drain:** Waiting for stream to settle
3. **Generating wait:** Waiting for Kimi to stop generating
4. **Submit verification:** `_submitWithVerification` loops
5. **Context rebuild:** `_buildContext()` for next turn

### Investigation Needed

1. Add timestamps at each phase
2. Measure ACTION_END → RESULT_SEND_START
3. Measure RESULT_SEND_START → ENTER_SENT
4. Measure ENTER_SENT → KIMI_OUTPUT_RESUMED

### Likely Resolution

The delay is likely caused by:
1. `_submitWithVerification` loops (verification + recovery)
2. Context rebuild (`_buildContext()`)
3. Kimi processing time

---

## 17. Deduplication Analysis

### Current Mechanisms (13 total)

| Mechanism | Scope | Type | Keep? |
|-----------|-------|------|-------|
| `_processedToolHashes` | Per-turn | TOOL | ✅ |
| `_detectedToolKeys` | Per-bubble | TOOL | ✅ |
| `_detectedResponseKeys` | Per-bubble | RESPONSE | ✅ |
| `_lastSentResponse` | Per-poll | RESPONSE | ✅ |
| `emittedActionCodes` | Per-stream | TOOL | ✅ |
| `emittedResponseHashes` | Per-stream | RESPONSE | ✅ |
| V2 Authority Gate | Per-stream | TOOL | ✅ |
| `startedToolHashes` | Per-turn | TOOL | ✅ |
| `_executedActionCache` | Per-session | TOOL | ✅ |
| `v2ResponseHandled` | Per-turn | RESPONSE | ❌ Remove |
| `flushedContentHashes` | Per-session | RESPONSE | ✅ |
| `shouldCreateToolCard()` | Per-session | TOOL | ✅ |
| `toolInstanceMap` | Per-session | TOOL | ✅ |

### Classification

| Type | Count | Keep | Remove |
|------|-------|------|--------|
| TOOL | 8 | 8 | 0 |
| RESPONSE | 4 | 3 | 1 |
| THINKING | 0 | 0 | 0 |
| LEGACY | 0 | 0 | 0 |
| UNKNOWN | 1 | 0 | 1 |

---

## 18. Minimal Patch Plan

### Phase 1: Revert Response Pipeline

1. Revert `DEFAULT_TOOL_RESULT_PROMPT` to verbose format
2. Revert `DEFAULT_MINI_REMINDER` to legacy instructions
3. Remove `v2ResponseHandled` flag
4. Remove `v2ResponseComplete` flag
5. Remove `luna_response_complete` handler
6. Remove `mapRuntimeEventToUiEvent` function
7. Remove watchdog timer
8. Revert `response_delta` filter

### Phase 2: Preserve Tool V2 Pipeline

1. Keep V2 Protocol Parser in injected.js
2. Keep V2 Authority Gate in kimi-bridge.cjs (tools only)
3. Keep `luna_tool_call_complete` handler in luna-soul.cjs
4. Keep tool dedup mechanisms
5. Keep `miniJsonRepair()`
6. Keep partial delimiter detection

### Phase 3: Modify V2 Authority Gate

1. Remove gate check for `response_detected` in kimi-bridge.cjs
2. Keep gate checks for `action_detected` and drains

### Phase 4: Test

1. Test Response simples
2. Test Tool + Response
3. Test múltiplas Tools
4. Test Response sem Tool

---

## 19. Test Plan

### Test A — Response simples

```
User: "Olá"
Expected: Response appears in chat, no truncation
```

### Test B — Tool + Response

```
User: "Crie arquivo teste.txt"
Expected: ToolCard + file created + response
```

### Test C — múltiplas Tools

```
User: "Leia arquivo e depois escreva poema"
Expected: ToolCard + ToolCard + response
```

### Test D — Response sem Tool

```
User: "Escreva um texto longo"
Expected: Full response appears, no truncation
```

### Test E — Response com Markdown

```
User: "Escreva markdown com tabela"
Expected: Table renders correctly
```

---

## 20. Rollback Plan

### If Response breaks

1. Revert `luna-soul.cjs` to `1e88ec8` version
2. Keep `injected.js` and `kimi-bridge.cjs` changes

### If Tools break

1. Revert `injected.js` to `1e88ec8` version
2. Revert `kimi-bridge.cjs` to `1e88ec8` version
3. Keep `luna-soul.cjs` changes

### If both break

1. Revert all files to `1e88ec8` version
2. Start over with smaller changes

---

## 21. Summary

### Changes by File

| File | Lines to Change | Risk |
|------|-----------------|------|
| `injected.js` | 0 (keep all) | Low |
| `kimi-bridge.cjs` | ~5 (remove response gate) | Low |
| `luna-soul.cjs` | ~100 (revert response, keep tool) | Medium |
| `ChatArea.svelte` | 0 (keep diagnostic logs) | Low |
| `LUNA_MASTER_PROMPT.md` | ~200 (revert to stable) | Low |
| `config/luna-prompt-config.json` | ~15 (revert to stable) | Low |

### Total Lines Changed

~320 lines (mostly reverts)

### Risk Assessment

- **Response Pipeline:** Low risk (reverting to known working state)
- **Tool Pipeline:** Low risk (keeping proven V2 code)
- **Integration:** Medium risk (need to test Response + Tool together)

### Next Step

**Implement Phase 1 (Revert Response Pipeline) and test.**

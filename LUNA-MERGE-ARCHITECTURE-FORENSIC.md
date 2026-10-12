# LUNA MERGE ARCHITECTURE FORENSIC

**Data:** 2026-08-16
**Status:** AUDITORIA READ-ONLY — NENHUMA ALTERAÇÃO DE CÓDIGO
**Base:** Commit `1e88ec8` (luna pc wardilias) + working directory changes

---

## 1. Executive Summary

### Objetivo

Mapear o Response antigo que funcionava e o Tool V2 atual para encontrar o **menor merge possível**.

### Descoberta Principal

O commit `1e88ec8` (luna pc wardilias) é o **último commit estável**. As mudanças V2 no working directory são **não commitadas**.

### Estado Atual

| Componente | Commit `1e88ec8` | Working Directory |
|------------|------------------|-------------------|
| Response Pipeline | ✅ Funcionando | ⚠️ Modificado |
| Tool Pipeline | Legacy JSON | V2 Protocol |
| injected.js | Original | V2 Protocol Parser |
| kimi-bridge.cjs | Original | V2 Authority Gate |
| luna-soul.cjs | Original | UI Event Boundary |

---

## 2. Current Architecture (Commit `1e88ec8`)

### 2.1 Response Pipeline (ANTIGO — FUNCIONAVA)

```
KIMI WEB
    ↓
injected.js (DOM observer)
    ├─ extractThinking() → THINKING
    └─ extractResponse() → RESPONSE
    ↓ postMessage
kimi-bridge.cjs
    ├─ state_change {thinking, response}
    ├─ response_delta (incremental)
    └─ response_detected (complete)
    ↓ yield
luna-soul.cjs
    ├─ response_delta → yield {type: 'response_delta', text, fullResponse}
    ├─ response_detected → yield {type: 'response_detected', text}
    └─ response_done → yield {type: 'response_done', response, thinking}
    ↓ SSE
ChatArea.svelte
    ├─ response_delta → responseBuffer += text → flush
    ├─ response_detected → flushResponseBuffer(force)
    └─ response_done → final flush
    ↓
AssistantMessage.svelte → Markdown render
```

### 2.2 Tool Pipeline (ANTIGO — LEGACY JSON)

```
KIMI WEB
    ↓
injected.js (DOM observer)
    └─ detectJsonBlocks() → JSON code blocks
    ↓ postMessage
kimi-bridge.cjs
    ├─ json_buffer → looksLikeJsonStart → brace counting
    ├─ dom_mirror → DOM structure extraction
    └─ json_block → late-stage scanning
    ↓ yield action_detected
luna-soul.cjs
    ├─ action_detected → dedup → yield action_start
    ├─ _executeActionAsync() → tool execution
    └─ eventBus.push(action_end)
    ↓ SSE
ChatArea.svelte
    ├─ action_start → create ToolCard
    └─ action_end → complete ToolCard
```

### 2.3 Key Functions (Commit `1e88ec8`)

| File | Function | Line | Responsibility |
|------|----------|------|----------------|
| `luna-soul.cjs` | `parseKimiResponse()` | ~531 | Multi-strategy JSON parser |
| `luna-soul.cjs` | `processMessageStream()` | ~2549 | Main message loop |
| `luna-soul.cjs` | `_stripJsonResponseWrapper()` | ~3846 | Strip JSON wrappers |
| `kimi-bridge.cjs` | `sendMessageStream()` | ~8542 | Stream generator |
| `kimi-bridge.cjs` | `_extractJsonBlocksFromDOM()` | ~7898 | JSON extraction |
| `injected.js` | `detectAndEmit()` | ~829 | Main poll loop |
| `injected.js` | `extractResponse()` | ~451 | Response extraction |

---

## 3. Legacy Response Pipeline (Commit `1e88ec8`)

### 3.1 How Response Was Captured

**Source:** DOM extraction via `extractResponse()` in injected.js

```javascript
// injected.js:451-474
function extractResponse(assistant, thinkingContainer) {
  // Queries SELECTORS.responseContainer within assistant
  // Skips nodes inside thinking container
  // Skips nodes inside tool containers
  // Returns text content
}
```

### 3.2 How Response Was Streamed

**Bridge:** `response_delta` events from `state_change`

```javascript
// kimi-bridge.cjs (commit 1e88ec8)
case 'state_change': {
  // DOM poller extracts response text
  // Feeds through responseCursor.next()
  // Yields response_delta
}
```

### 3.3 How Response Was Accumulated

**Soul:** `fullResponse` variable

```javascript
// luna-soul.cjs (commit 1e88ec8)
case 'response_delta': {
  let cleanText = this._stripJsonResponseWrapper(event.text || '');
  fullResponse += cleanText;
  yield { type: 'response_delta', text: cleanText, fullResponse, sessionId };
}
```

### 3.4 How Response Was Finalized

**Soul:** `response_detected` event

```javascript
// luna-soul.cjs (commit 1e88ec8)
case 'response_detected': {
  let respText = this._stripJsonResponseWrapper(event.response || '');
  if (respText) {
    yield { type: 'response_detected', text: respText, sessionId };
  }
}
```

### 3.5 What Legacy Did Well

1. **Simple extraction:** DOM selectors for thinking/response containers
2. **Channel separation:** Thinking container = THINKING, everything else = OUTPUT
3. **Streaming:** Incremental `response_delta` for real-time display
4. **Fallback:** Multiple extraction strategies (DOM, network, snapshot diff)
5. **Wrapper stripping:** `_stripJsonResponseWrapper()` removes JSON wrappers

### 3.6 What Legacy Did Poorly

1. **No semantic classification:** Raw text could contain tool JSON
2. **Multiple detection sources:** 6+ sources competing
3. **No authority gate:** Legacy and V2 could emit simultaneously
4. **Response truncation:** Multiple paths could corrupt response

---

## 4. Current V2 Tool Pipeline (Working Directory)

### 4.1 V2 Protocol Parser

**File:** `injected.js` (working directory)

**Protocol Constants:**
```javascript
const TOOL_OPEN = '<luna_tool_call>';
const TOOL_CLOSE = '</luna_tool_call>';
const RESPONSE_OPEN = '<luna_response>';
const RESPONSE_CLOSE = '</luna_response>';
```

**State Machine:**
```
IDLE → TOOL_BUFFERING → TOOL_COMPLETE → VALIDATING → READY → IDLE
IDLE → RESPONSE_BUFFERING → RESPONSE_COMPLETE → READY → IDLE
```

### 4.2 V2 Authority Gate

**File:** `kimi-bridge.cjs` (working directory)

```javascript
let v2AuthorityActive = false;
let v2AuthorityType = null; // 'tool' or 'response'

// When V2 produces valid event:
v2AuthorityActive = true;
v2AuthorityType = 'tool'; // or 'response'

// Legacy blocked when:
if (v2AuthorityActive && v2AuthorityType === 'tool' && ev.source !== 'delimited_protocol') {
  // BLOCKED
}
```

### 4.3 V2 Tool Flow

```
1. injected.js: detectAndEmit()
2. Protocol Parser: IDLE → TOOL_BUFFERING
3. findProtocolClose() → found
4. TOOL_COMPLETE → VALIDATING
5. JSON.parse() + miniJsonRepair fallback
6. Validate name + arguments
7. Dedup check (_processedToolHashes)
8. READY → emit luna_tool_call_complete
9. Set _v2AuthorityActive = true
10. kimi-bridge.cjs: V2 Authority Gate → block legacy
11. yield action_detected {source: 'delimited_protocol'}
12. luna-soul.cjs: dedup → yield action_start
13. _executeActionAsync() → tool execution
14. eventBus.push(action_end)
```

### 4.4 V2 Response Flow

```
1. injected.js: detectAndEmit()
2. Protocol Parser: IDLE → RESPONSE_BUFFERING
3. findProtocolClose() → found
4. RESPONSE_COMPLETE → READY
5. emit luna_response_complete
6. Set _v2AuthorityActive = true, _v2AuthorityType = 'response'
7. kimi-bridge.cjs: response_detected yield
8. luna-soul.cjs: strip <luna_response> wrapper
9. yield response_detected
10. cancelStream() — immediate turn termination
```

---

## 5. Thinking Pipeline

### 5.1 Current Implementation

**File:** `injected.js`

```javascript
// Line 292-305
function findThinkingContainer(assistant) {
  // Two passes over SELECTORS.thinkingContainer candidates
  // First pass: prefers nodes with 'thinking-container' in className
  // Second pass: accepts 'thinking', 'think-container', 'reasoning', 'thought'
}

// Line 347-390
function extractThinking(thinkingContainer) {
  // Uses textContent (not innerText) to capture full reasoning
  // Strips chrome (Copy buttons, header text)
}
```

### 5.2 Channel Detection

```
DOM .thinking-container → THINKING channel
DOM .response-container → OUTPUT channel
```

**Rule:** If channel=THINKING, content is ALWAYS thinking, even if it contains `<luna_tool_call>`.

---

## 6. Full Event Flow

### 6.1 Case A: Simple Response (no Tool)

```
1. Kimi: thinking → response
2. injected.js: extractResponse() → "Olá mundo"
3. injected.js: hasProtocolDelimiter? NO
4. injected.js: emitStreamState(thinking, "Olá mundo", true)
5. kimi-bridge.cjs: state_change → response_delta yield
6. luna-soul.cjs: response_delta → fullResponse += cleanText → yield
7. ChatArea.svelte: responseBuffer += deltaText → flush
8. AssistantMessage.svelte: render markdown
```

### 6.2 Case B: V2 Tool → Response

```
1. Kimi: thinking → tool call
2. injected.js: Protocol Parser: IDLE → TOOL_BUFFERING → TOOL_COMPLETE
3. injected.js: emit luna_tool_call_complete
4. kimi-bridge.cjs: V2 Authority Gate → action_detected yield
5. luna-soul.cjs: dedup → yield action_start → _executeActionAsync()
6. luna-soul.cjs: buildToolResultPrompt() → send to Kimi
7. Kimi: thinking → response
8. injected.js: Protocol Parser: IDLE → RESPONSE_BUFFERING → RESPONSE_COMPLETE
9. injected.js: emit luna_response_complete
10. kimi-bridge.cjs: response_detected yield
11. luna-soul.cjs: strip wrapper → yield response_detected
12. ChatArea.svelte: flush response
```

### 6.3 Case C: Legacy JSON Tool (Commit `1e88ec8`)

```
1. Kimi: thinking → JSON code block
2. injected.js: detectJsonBlocks() → finds {"tool":"writeFile",...}
3. kimi-bridge.cjs: json_buffer → action_detected yield
4. luna-soul.cjs: dedup → yield action_start → _executeActionAsync()
5. luna-soul.cjs: buildToolResultPrompt() → send to Kimi
6. Kimi: thinking → response
7. kimi-bridge.cjs: response_delta yield
8. luna-soul.cjs: response_delta → yield
9. ChatArea.svelte: flush response
```

---

## 7. `996 → 462` Forensic Trace

### 7.1 Observed in Logs

```
RAW_OUTPUT len=996
TOOL_COMPLETE bufferSize=462
```

### 7.2 Possible Causes

1. **Wrapper stripping:** `<luna_tool_call>` (15 chars) + `</luna_tool_call>` (16 chars) = 31 chars
2. **JSON extraction:** Only JSON content between tags is buffered
3. **Whitespace:** Leading/trailing whitespace trimmed
4. **Content difference:** 996 includes thinking/response, 462 is only tool JSON

### 7.3 Investigation Needed

- Capture exact raw output and buffer content
- Compare character by character
- Identify where 534 chars are lost

### 7.4 Hypothesis

The 996 chars likely include:
- `<luna_tool_call>` (15 chars)
- JSON content (462 chars)
- `</luna_tool_call>` (16 chars)
- Additional text (403 chars) — possibly thinking or response content

The 462 chars are likely just the JSON content between the tags.

---

## 8. Response Truncation Analysis

### 8.1 Observed Issue

```
Kimi RAW: Response completa (~800 chars)
Luna Web: Response truncada (~15 chars)
```

### 8.2 Possible Causes

1. **Multiple response sources:** Legacy and V2 emitting simultaneously
2. **Buffer overwrite:** Later response overwrites earlier complete response
3. **Dedup hash collision:** Different responses treated as duplicate
4. **Event ordering:** `response_delta` after `response_detected` overwrites

### 8.3 Investigation Needed

- Trace response through all layers
- Capture length at each point
- Identify where truncation occurs

---

## 9. Tool Delay Analysis

### 9.1 Observed Delay

```
ACTION_END → ~1 minute → KIMI output resumes
```

### 9.2 Possible Causes

1. **Processing lock:** `session.processing` wait
2. **Stream drain:** Waiting for stream to settle
3. **Generating wait:** Waiting for Kimi to stop generating
4. **Submit verification:** `_submitWithVerification` loops
5. **Recovery:** Crash recovery retries
6. **Context rebuild:** `_buildContext()` for next turn

### 9.3 Investigation Needed

- Add timestamps at each phase
- Measure ACTION_END → RESULT_SEND_START
- Measure RESULT_SEND_START → ENTER_SENT
- Measure ENTER_SENT → KIMI_OUTPUT_RESUMED

---

## 10. Response/Tool Collision Points

### 10.1 Collision Matrix

| File | Line | System | Function | What It Does | Must Stay? |
|------|------|--------|----------|--------------|------------|
| `injected.js` | 931-936 | V2 | `hasProtocolDelimiter` | Check for protocol tags | ✅ |
| `injected.js` | 969-974 | V2 | `hasPartialDelimiter` | Check for partial tags | ✅ |
| `injected.js` | 1040-1058 | V2 | Protocol Parser | TOOL_BUFFERING | ✅ |
| `injected.js` | 1152-1156 | V2 | Protocol Parser | RESPONSE_COMPLETE | ✅ |
| `kimi-bridge.cjs` | 8966-8967 | V2 | V2 Authority Gate | Block legacy | ✅ |
| `kimi-bridge.cjs` | 9296-9301 | V2 | action_detected gate | Block legacy tools | ✅ |
| `kimi-bridge.cjs` | 9346-9349 | V2 | response_detected gate | Block legacy responses | ✅ |
| `luna-soul.cjs` | 2886-2898 | Legacy | response_detected | Legacy response | ⚠️ |
| `luna-soul.cjs` | 3064-3096 | V2 | luna_response_complete | V2 response | ✅ |
| `luna-soul.cjs` | 3001-3061 | V2 | luna_tool_call_complete | V2 tool | ✅ |
| `luna-soul.cjs` | 2901-2998 | Legacy | action_detected | Legacy tool | ⚠️ |

### 10.2 Key Observation

The V2 Authority Gate blocks legacy when V2 is active. But if V2 doesn't activate (no `<luna_tool_call>` or `<luna_response>` tags), legacy should still work.

---

## 11. Exact Files + Functions + Line Numbers

### 11.1 Response Pipeline

| File | Function | Lines | System | Status |
|------|----------|-------|--------|--------|
| `injected.js` | `extractResponse()` | 451-474 | Legacy | ✅ Keep |
| `injected.js` | `detectAndEmit()` | 829-1280 | V2+Legacy | ✅ Keep |
| `injected.js` | `emitStreamState()` | 829-836 | Legacy | ✅ Keep |
| `kimi-bridge.cjs` | `sendMessageStream()` | 8542-9919 | Both | ✅ Keep |
| `luna-soul.cjs` | `processMessageStream()` | 2549-3585 | Both | ✅ Keep |
| `luna-soul.cjs` | `_stripJsonResponseWrapper()` | 3846 | Legacy | ✅ Keep |
| `ChatArea.svelte` | `handleEvent()` | 407-1165 | Frontend | ✅ Keep |
| `ChatArea.svelte` | `flushResponseBuffer()` | 139-241 | Frontend | ✅ Keep |

### 11.2 Tool Pipeline

| File | Function | Lines | System | Status |
|------|----------|-------|--------|--------|
| `injected.js` | `findProtocolStart()` | 708-724 | V2 | ✅ Keep |
| `injected.js` | `findPartialMatch()` | 727-735 | V2 | ✅ Keep |
| `injected.js` | `findProtocolClose()` | 738-740 | V2 | ✅ Keep |
| `injected.js` | `miniJsonRepair()` | 526-559 | V2 | ✅ Keep |
| `kimi-bridge.cjs` | V2 Authority Gate | 8966-8967 | V2 | ✅ Keep |
| `luna-soul.cjs` | `luna_tool_call_complete` handler | 3001-3061 | V2 | ✅ Keep |
| `luna-soul.cjs` | `_executeActionAsync()` | 4869 | Both | ✅ Keep |

---

## 12. Preserve / Modify / Remove Matrix

### PRESERVAR

| Component | Reason |
|-----------|--------|
| V2 Protocol Parser | Core of new architecture |
| Channel Detection | THINKING/OUTPUT separation works |
| V2 Authority Gate | Prevents legacy/V2 conflict |
| Tool Dedup Chain | Prevents duplicate execution |
| Response extraction (DOM) | Works correctly |
| Thinking extraction | Works correctly |
| Markdown renderer | Works correctly |
| SSE transport | Works correctly |
| ToolCard UI | Works correctly |

### ALTERAR

| Component | Change Needed |
|-----------|---------------|
| `kimi-bridge.cjs` response_delta | Ensure V2 response doesn't leak as delta |
| `luna-soul.cjs` response_detected | Ensure V2 response takes priority |
| `injected.js` partial delimiter | Fix edge cases |
| Context building | Reduce bloat |

### REMOVER (depois de provado)

| Component | Reason |
|-----------|--------|
| Legacy JSON detection | After V2 proven stable |
| `dom_mirror` source | After V2 covers all cases |
| `json_buffer` source | After V2 covers all cases |
| Duplicate dedup mechanisms | After consolidation |

### NÃO TOCAR

| Component | Reason |
|-----------|--------|
| `luna-tools.cjs` | Tool implementations stable |
| `luna-tool-guard.cjs` | Safety mechanisms critical |
| `session-manager.cjs` | Session persistence stable |
| `api.js` | SSE/HTTP client stable |
| `stores.js` | Svelte stores stable |
| `AssistantMessage.svelte` | Markdown renderer working |
| `ToolCard.svelte` | Tool UI working |
| `ThinkingBubble.svelte` | Thinking UI working |

---

## 13. Minimal Merge Architecture

### 13.1 Proposed Architecture

```
KIMI WEB
    ↓
injected.js (DOM observer)
    ├─ extractThinking() → THINKING
    ├─ extractResponse() → RESPONSE (for legacy fallback)
    └─ V2 Protocol Parser → TOOL_CALL / RESPONSE (for V2)
    ↓ postMessage
kimi-bridge.cjs
    ├─ V2 Authority Gate
    ├─ Legacy sources (gated)
    └─ V2 sources
    ↓ yield
luna-soul.cjs
    ├─ V2 handlers (priority)
    ├─ Legacy handlers (fallback)
    └─ Common execution path
    ↓ SSE
ChatArea.svelte → Components
```

### 13.2 Key Principle

**V2 is authority when active. Legacy is fallback when V2 doesn't activate.**

### 13.3 Minimal Changes

1. **injected.js:** Keep V2 Protocol Parser + partial delimiter fix
2. **kimi-bridge.cjs:** Keep V2 Authority Gate + ensure V2 response doesn't leak as delta
3. **luna-soul.cjs:** Keep V2 handlers + ensure V2 response takes priority
4. **ChatArea.svelte:** Keep current response handling

---

## 14. Migration Plan

### Phase 1: Restore Response (without touching Tools)

1. Ensure legacy `response_detected` works when V2 not active
2. Ensure V2 `luna_response_complete` works when V2 active
3. Test: simple response, long response, markdown response

### Phase 2: Run Response + Tool Simultaneously

1. Ensure V2 Tool works with legacy Response
2. Ensure V2 Tool works with V2 Response
3. Test: tool → response, response → tool → response

### Phase 3: Resolve Conflict/Dedup

1. Ensure V2 Authority Gate blocks legacy when V2 active
2. Ensure legacy works when V2 not active
3. Test: V2 tool + legacy response, legacy tool + V2 response

### Phase 4: Fix Delays

1. Instrument ACTION_END → KIMI_OUTPUT
2. Identify bottleneck
3. Optimize without breaking functionality

### Phase 5: Tests

1. Run all golden cases
2. Verify no regressions
3. Document remaining issues

### Phase 6: Remove Dead Code

1. Remove legacy sources after V2 proven stable
2. Remove duplicate dedup mechanisms
3. Clean up unused functions

---

## 15. Risks

1. **Legacy removal:** Could break fallback for non-V2 providers
2. **Response consolidation:** Could break streaming display
3. **Dedup consolidation:** Could allow duplicates or miss events
4. **Context reduction:** Could lose important context for Kimi
5. **Tool Result simplification:** Could break Kimi's understanding

---

## 16. Validation/Test Plan

### Test 1: Simple Response

```
User: "Olá"
Expected: Response appears in chat
```

### Test 2: Tool Execution

```
User: "Crie arquivo teste.txt"
Expected: ToolCard + file created + response
```

### Test 3: Tool → Response

```
User: "Leia arquivo e me diga o conteúdo"
Expected: ToolCard + response with content
```

### Test 4: Response → Tool → Response

```
User: "Leia arquivo, depois escreva poema"
Expected: ToolCard + ToolCard + response
```

### Test 5: Long Response

```
User: "Escreva um texto longo"
Expected: Full response appears, no truncation
```

### Test 6: Markdown Response

```
User: "Escreva markdown com tabela"
Expected: Table renders correctly
```

---

## 17. Exact Files Kimi Precisa Ler Para Implementar

### Core Files

1. `packages/kernel/luna-extension/injected.js` — V2 Protocol Parser
2. `packages/kernel/kimi-bridge.cjs` — V2 Authority Gate
3. `packages/kernel/luna-soul.cjs` — Response/Tool handlers
4. `packages/kernel/luna-web/src/components/ChatArea.svelte` — Frontend

### Reference Files

5. `packages/kernel/lib/tool-json-parser.cjs` — JSON repair
6. `packages/kernel/lib/tool-dedup-key.cjs` — Dedup keys
7. `packages/kernel/config/luna-prompt-config.json` — Prompt templates

### Documentation

8. `LUNA-MERGE-FORENSIC-REPORT.md` — Full forensic report
9. `LUNA-V2-AUTHORITY-DESIGN.md` — V2 design
10. `LUNA-UI-EVENT-SOURCES.md` — Event inventory

# LUNA — EVENT REFERENCE MAP

**Data:** 2026-08-16
**Status:** FORENSIC TRACE — NENHUMA ALTERAÇÃO

---

## 1. `response_detected` References

### luna-soul.cjs

| Line | Context | Action |
|------|---------|--------|
| 2775 | UI Event Boundary VALID_UI_EVENT_TYPES | KEEP |
| 2886 | Legacy handler: `case 'response_detected'` | KEEP |
| 2895 | Legacy yield: `yield { type: 'response_detected', text: respText }` | KEEP |
| 3082-3083 | V2 handler: `yield { type: 'response_detected', text: cleanResponse, source: 'delimited_protocol' }` | **REMOVE** |
| 3357 | V2 post-stream: `yield { type: 'response_detected', text: fullResponse, source: 'delimited_protocol' }` | **REMOVE** |

### kimi-bridge.cjs

| Line | Context | Action |
|------|---------|--------|
| 6326 | V2 `luna_response_complete` → `response_detected` | **REMOVE** |
| 6352-6355 | Legacy `tool_response_detected` → `response_detected` | KEEP |
| 6391 | Legacy DOM observer → `response_detected` | KEEP |
| 6524-6527 | Legacy poller → `response_detected` | KEEP |
| 6624-6627 | Legacy generic provider → `response_detected` | KEEP |
| 6646-6648 | Legacy poller → `response_detected` | KEEP |
| 6667-6670 | Legacy poller → `response_detected` | KEEP |
| 6743 | Legacy JSON block → `response_detected` | KEEP |
| 6820-6829 | Dedup for `response_detected` | KEEP |
| 9343-9358 | sendMessageStream: `response_detected` case | KEEP |
| 9554 | Post-close drain: discard `response_detected` | KEEP |

### ChatArea.svelte

| Line | Context | Action |
|------|---------|--------|
| 162 | Comment about dedup | KEEP |
| 215 | Comment about forceText | KEEP |
| 427 | isResponseEvent check | KEEP |
| 578-588 | `case 'response_detected'` handler | KEEP |

---

## 2. `response_delta` References

### luna-soul.cjs

| Line | Context | Action |
|------|---------|--------|
| 2775 | UI Event Boundary VALID_UI_EVENT_TYPES | KEEP |
| 2855-2858 | V2 UI Event Mapper filter | **REVERT** (remove filter) |
| 2860 | Legacy yield: `yield { type: 'response_delta', text: cleanText, fullResponse }` | KEEP |

### kimi-bridge.cjs

| Line | Context | Action |
|------|---------|--------|
| 9193-9270 | sendMessageStream: 9 `response_delta` yield points | KEEP |

### ChatArea.svelte

| Line | Context | Action |
|------|---------|--------|
| 40 | `responseBuffer` declaration | KEEP |
| 555-577 | `case 'response_delta'` handler | KEEP |

---

## 3. `response_done` References

### luna-soul.cjs

| Line | Context | Action |
|------|---------|--------|
| 2775 | UI Event Boundary VALID_UI_EVENT_TYPES | KEEP |
| 2606 | Debug terminal: `yield { type: 'response_done' }` | KEEP |
| 2676 | File upload: `yield { type: 'response_done' }` | KEEP |
| 3151 | Main stream: `yield { type: 'response_done', response: fullResponse }` | KEEP |

### ChatArea.svelte

| Line | Context | Action |
|------|---------|--------|
| 839-852 | `case 'response_done'` handler | KEEP |

---

## 4. `luna_response_complete` References

### injected.js

| Line | Context | Action |
|------|---------|--------|
| 1152 | V2 protocol: `queueEvent('luna_response_complete', { response, protocol, channel })` | **REMOVE** |
| 1162-1163 | V2 authority: `_v2AuthorityActive = true, _v2AuthorityType = 'response'` | **REMOVE** |

### kimi-bridge.cjs

| Line | Context | Action |
|------|---------|--------|
| 6321-6335 | `case 'luna_response_complete'` handler → `response_detected` yield | **REMOVE** |
| 6333-6334 | V2 authority: `v2AuthorityActive = true, v2AuthorityType = 'response'` | **REMOVE** |

### luna-soul.cjs

| Line | Context | Action |
|------|---------|--------|
| 3064-3096 | `case 'luna_response_complete'` handler | **REMOVE** |
| 3079 | `v2ResponseHandled = true` | **REMOVE** |
| 3080 | `v2ResponseComplete = true` | **REMOVE** |

---

## 5. V2 Authority Gate References

### injected.js

| Line | Context | Action |
|------|---------|--------|
| 674-675 | Declaration: `_v2AuthorityActive`, `_v2AuthorityType` | KEEP |
| 689-690 | Reset in `resetTurnProtocolState()` | KEEP |
| 696-699 | `isV2BlockingLegacy()` function | MODIFY (tools only) |
| 812-815 | Gate in `emitFinalToolCalls()` | KEEP |
| 1133-1134 | Set on V2 tool: `_v2AuthorityType = 'tool'` | KEEP |
| 1162-1163 | Set on V2 response: `_v2AuthorityType = 'response'` | **REMOVE** |

### kimi-bridge.cjs

| Line | Context | Action |
|------|---------|--------|
| 8966-8967 | Declaration: `v2AuthorityActive`, `v2AuthorityType` | KEEP |
| 9067-9070 | Hard cancel drain: block legacy tools | KEEP |
| 9298-9301 | action_detected: block legacy tools | KEEP |
| 9347-9349 | response_detected: block legacy responses | **REMOVE** |
| 9544-9547 | Post-close drain: block legacy tools | KEEP |

---

## 6. `v2ResponseHandled` / `v2ResponseComplete` References

### luna-soul.cjs

| Line | Context | Action |
|------|---------|--------|
| 2754 | Declaration: `let v2ResponseHandled = false` | **REMOVE** |
| 2756 | Declaration: `let v2ResponseComplete = false` | **REMOVE** |
| 2888 | Check: `if (v2ResponseHandled)` → skip legacy response | **REMOVE** |
| 3079 | Set: `v2ResponseHandled = true` | **REMOVE** |
| 3080 | Set: `v2ResponseComplete = true` | **REMOVE** |
| 3350 | Check: `if (v2ResponseComplete)` → yield done | **REMOVE** |

---

## 7. UI Event Boundary References

### luna-soul.cjs

| Line | Context | Action |
|------|---------|--------|
| 2765-2780 | `mapRuntimeEventToUiEvent` function | **REMOVE** |
| 2855-2858 | Apply filter to `response_delta` | **REVERT** |

---

## 8. Watchdog References

### luna-soul.cjs

| Line | Context | Action |
|------|---------|--------|
| 2781-2790 | Watchdog timer declaration | **REMOVE** |
| 2815-2816 | Reset watchdog on event | **REMOVE** |

---

## 9. Summary of Changes

### REMOVE (V2 Response path)

| File | Lines | What |
|------|-------|------|
| `injected.js` | 1152-1163 | `luna_response_complete` emission + V2 response authority |
| `kimi-bridge.cjs` | 6321-6335 | `luna_response_complete` handler |
| `kimi-bridge.cjs` | 9347-9349 | V2 gate for response_detected |
| `luna-soul.cjs` | 2754-2756 | `v2ResponseHandled`, `v2ResponseComplete` declarations |
| `luna-soul.cjs` | 2765-2780 | `mapRuntimeEventToUiEvent` function |
| `luna-soul.cjs` | 2781-2790 | Watchdog timer |
| `luna-soul.cjs` | 2815-2816 | Watchdog reset |
| `luna-soul.cjs` | 2855-2858 | UI Event Mapper filter on response_delta |
| `luna-soul.cjs` | 2888-2891 | `v2ResponseHandled` check |
| `luna-soul.cjs` | 3064-3096 | `luna_response_complete` handler |
| `luna-soul.cjs` | 3350-3361 | `v2ResponseComplete` check |

### KEEP (V2 Tool path)

| File | Lines | What |
|------|-------|------|
| `injected.js` | 635-740 | V2 Protocol Parser (tools) |
| `injected.js` | 812-815 | V2 gate in `emitFinalToolCalls` |
| `injected.js` | 1040-1145 | V2 tool detection + validation |
| `kimi-bridge.cjs` | 6302-6317 | `luna_tool_call_complete` handler |
| `kimi-bridge.cjs` | 8966-8967 | V2 authority flags |
| `kimi-bridge.cjs` | 9067-9070 | V2 gate: hard cancel drain |
| `kimi-bridge.cjs` | 9298-9301 | V2 gate: action_detected |
| `kimi-bridge.cjs` | 9544-9547 | V2 gate: post-close drain |
| `luna-soul.cjs` | 3001-3061 | `luna_tool_call_complete` handler |

### KEEP (Legacy Response path)

| File | Lines | What |
|------|-------|------|
| `luna-soul.cjs` | 2886-2898 | `response_detected` handler |
| `luna-soul.cjs` | 2860 | `response_delta` yield |
| `kimi-bridge.cjs` | 9343-9358 | `response_detected` yield |
| `ChatArea.svelte` | 555-577 | `response_delta` handler |
| `ChatArea.svelte` | 578-595 | `response_detected` handler |
| `ChatArea.svelte` | 839-852 | `response_done` handler |

---

## 10. Surgical Cut Points

### Cut 1: injected.js — Remove V2 Response emission

**Lines 1152-1163:** Remove `luna_response_complete` emission and V2 response authority set.

### Cut 2: kimi-bridge.cjs — Remove V2 Response handler

**Lines 6321-6335:** Remove `luna_response_complete` case handler.

### Cut 3: kimi-bridge.cjs — Remove V2 Response gate

**Lines 9347-9349:** Remove gate check for `response_detected`.

### Cut 4: luna-soul.cjs — Remove V2 Response flags

**Lines 2754-2756:** Remove `v2ResponseHandled`, `v2ResponseComplete` declarations.

### Cut 5: luna-soul.cjs — Remove UI Event Boundary

**Lines 2765-2780:** Remove `mapRuntimeEventToUiEvent` function.

### Cut 6: luna-soul.cjs — Remove Watchdog

**Lines 2781-2790, 2815-2816:** Remove watchdog timer.

### Cut 7: luna-soul.cjs — Remove response_delta filter

**Lines 2855-2858:** Remove UI Event Mapper filter.

### Cut 8: luna-soul.cjs — Remove v2ResponseHandled check

**Lines 2888-2891:** Remove check that skips legacy response.

### Cut 9: luna-soul.cjs — Remove luna_response_complete handler

**Lines 3064-3096:** Remove entire handler.

### Cut 10: luna-soul.cjs — Remove v2ResponseComplete check

**Lines 3350-3361:** Remove check that yields done.

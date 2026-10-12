# LUNA — V2 AUTHORITY DESIGN

**Data:** 2026-08-16
**Status:** FASE A + B IMPLEMENTADAS

---

## 1. V2 Authority

### Regra

Quando `LUNA_PROTOCOL=v2`, somente o V2 pode produzir:

- `TOOL_CALL`
- `RESPONSE`

O Legacy NÃO pode emitir semântica paralela.

### Implementação

**FASE A:** Dedup de tool hash antes de gerar toolId (CONCLUÍDA)

```javascript
// FASE A: Check if this tool has already been processed this turn
const toolHash = hashString(_protocolBuffer);
if (_processedToolHashes.has(toolHash)) {
  console.log(`[PROTOCOL][DEDUP] time=${Date.now()} tool=${toolCall.name} hash=${toolHash} reason=already_processed`);
  resetProtocol();
  return;
}
// Mark this tool as processed
_processedToolHashes.add(toolHash);
```

**FASE B:** V2 Authority Gate (CONCLUÍDA)

#### injected.js

```javascript
// FASE B: V2 Authority Gate - track when V2 has produced a valid event
let _v2AuthorityActive = false;
let _v2AuthorityType = null; // 'tool' or 'response'

// FASE B: Check if V2 authority is blocking legacy
function isV2BlockingLegacy(eventType) {
  if (!_v2AuthorityActive) return false;
  // V2 blocks legacy for the same type
  if (_v2AuthorityType === 'tool' && eventType === 'tool') return true;
  if (_v2AuthorityType === 'response' && eventType === 'response') return true;
  return false;
}
```

When V2 produces a valid TOOL_CALL or RESPONSE:
```javascript
_v2AuthorityActive = true;
_v2AuthorityType = 'tool'; // or 'response'
```

Legacy paths check:
```javascript
if (!isV2BlockingLegacy('tool')) {
  // Legacy tool detection
}
if (!isV2BlockingLegacy('response')) {
  // Legacy response detection
}
```

#### kimi-bridge.cjs

```javascript
// FASE B: V2 Authority Gate - track when V2 has produced a valid event
let v2AuthorityActive = false;
let v2AuthorityType = null; // 'tool' or 'response'
```

When V2 produces a valid TOOL_CALL or RESPONSE:
```javascript
v2AuthorityActive = true;
v2AuthorityType = 'tool'; // or 'response'
```

Legacy paths check:
```javascript
if (v2AuthorityActive && v2AuthorityType === 'tool' && ev.source !== 'delimited_protocol') {
  log.info(`[V2_AUTHORITY][BLOCKED] time=${Date.now()} reason=legacy_tool_blocked_by_v2 source=${ev.source}`);
  break;
}
```

---

## 2. FASE B — COBERTURA COMPLETA

### Auditoria Estática

**Data:** 2026-08-16
**Status:** ✅ APROVADA

#### Emissões em injected.js

| Evento | Linha | Origem | V2 Gate? | Pode escapar? |
|--------|-------|--------|----------|---------------|
| `tool_call_detected` | 822 | `emitFinalToolCalls` | ✅ GATED | NÃO |
| `json_block_added` | 823 | `emitFinalToolCalls` | ✅ GATED | NÃO |
| `luna_tool_call_complete` | 1111 | V2 Protocol | N/A (V2) | N/A |
| `tool_call_detected` | 1120 | V2 backward compat | N/A (V2) | N/A |
| `luna_response_complete` | 1152 | V2 Protocol | N/A (V2) | N/A |
| `tool_response_detected` | 1204 | Legacy response | ✅ GATED | NÃO |
| `json_block_added` | 1205 | Legacy response | ✅ GATED | NÃO |

#### Emissões em kimi-bridge.cjs

| Evento | Linha | Origem | V2 Gate? | Pode escapar? |
|--------|-------|--------|----------|---------------|
| `action_detected` | 9070 | Hard cancel drain | ✅ GATED | NÃO |
| `response_detected` | 9353 | Response detection | ✅ GATED | NÃO |
| `action_detected` | 9542 | Post-close drain | ✅ GATED | NÃO |

#### Resumo

| Categoria | Quantidade |
|-----------|------------|
| Total de emissores encontrados | 10 |
| Gated (Legacy) | 7 |
| V2 (não aplicável) | 3 |
| Não gated | 0 |

#### Critérios de Aprovação

| Critério | Status |
|----------|--------|
| Todos os emissores Legacy mapeados | ✅ |
| Todos os emissores semânticos atrás do gate | ✅ |
| Tool V2 bloquear Legacy Tool | ✅ |
| Response V2 bloquear Legacy Response | ✅ |
| Gate resetar por turno | ✅ |
| Dual continuar permitindo fallback | ✅ |

#### Conclusão

Prosseguir para **FASE C: Raw output não chega à UI**.

---

## 3. Legacy Quarantine

### Regra

Legacy fica atrás de `legacyFallbackEnabled` e só é usado se:

1. V2 não produziu um evento válido
2. A feature flag permitir fallback

Se V2 produziu `TOOL_CALL` ou `RESPONSE`, o Legacy fica BLOQUEADO para aquele turno.

### Implementação

**PENDENTE**

---

## 3. Event Ownership

### Proprietário de cada evento

| Evento | Proprietário |
|--------|--------------|
| `THINKING` | injected.js (channel detection) |
| `TOOL_CALL` | V2 Protocol Parser |
| `RESPONSE` | V2 Protocol Parser |
| `UNKNOWN` | V2 Protocol Parser |
| `action_start` | luna-soul.cjs (runtime) |
| `action_end` | luna-soul.cjs (runtime) |
| `response_delta` | luna-soul.cjs (runtime) |
| `response_detected` | luna-soul.cjs (runtime) |
| `done` | luna-soul.cjs (runtime) |

---

## 4. UI Event Contract

### Princípio

A UI NÃO deve descobrir semanticamente o que um texto é. Ela deve receber eventos já classificados.

**ERRADO:**
```
RAW TEXT → UI → procura "<luna_tool_call>" → decide ocultar
```

**CORRETO:**
```
RAW → PROTOCOL → NORMALIZED EVENT → RUNTIME → UI EVENT → COMPONENT
```

### Eventos que a UI recebe

| Evento | UI |
|--------|-----|
| `thinking_start` | ThinkingBubble |
| `thinking_delta` | ThinkingBubble |
| `thinking_update` | ThinkingBubble |
| `response_delta` | AssistantMessage |
| `response_detected` | AssistantMessage |
| `response_done` | AssistantMessage |
| `action_start` | ToolCard |
| `action_progress` | ToolCard |
| `action_end` | ToolCard |
| `done` | Stream complete |

### Eventos que a UI NÃO recebe

- Raw model chunks
- `<luna_tool_call>`
- `</luna_tool_call>`
- `<luna_response>`
- `</luna_response>`
- JSON legacy
- DOM mirror
- orphan output
- UNKNOWN como mensagem visual

### Implementação FASE C

**UI Event Boundary** implementado em `luna-soul.cjs`:

```javascript
const VALID_UI_EVENT_TYPES = new Set([
  'thinking_start', 'thinking_delta', 'thinking_update',
  'response_delta', 'response_detected', 'response_done',
  'action_start', 'action_progress', 'action_end',
  'done', 'system', 'error', 'confirmation_required', 'mode_detected',
  'can_steer', 'waiting'
]);

const mapRuntimeEventToUiEvent = (event) => {
  if (!event) return null;

  // Only allow known semantic event types
  if (!VALID_UI_EVENT_TYPES.has(event.type)) {
    console.error(`[UI_BOUNDARY][UNKNOWN_TYPE] time=${Date.now()} type=${event.type} — blocked`);
    return null;
  }

  // PROTOCOL LEAK detection: if classified event still contains protocol tags
  const text = event.text || event.fullText || event.response || '';
  if (text.includes('<luna_tool_call>') || text.includes('</luna_tool_call>') ||
      text.includes('<luna_response>') || text.includes('</luna_response>')) {
    console.error(`[UI_BOUNDARY][PROTOCOL_LEAK] time=${Date.now()} type=${event.type} text_preview="${text.substring(0, 100)}"`);
    // Don't block — log for diagnosis. The protocol parser should have stripped these.
  }

  return event;
};
```

**Aplicado a:**
- `thinking_delta` events
- `response_delta` events

**Status:** ✅ IMPLEMENTADO

---

## 5. Tool Identity

### Regra

MESMO:
- turn/session
- channel
- raw payload hash

não pode gerar uma nova Tool sem mudança real de conteúdo.

### Implementação

**FASE A:** `_processedToolHashes` Set (CONCLUÍDA)

---

## 6. Tool Result Contract

### Representação canônica

```javascript
{
  type: "tool_result",
  toolInstanceId,
  tool,
  status,
  result
}
```

### Regra

Somente uma função deve transformá-lo em:

```
<luna_tool_result>
...
</luna_tool_result>
```

### Implementação

**PENDENTE**

---

## 7. Latency Instrumentation

### Timestamps obrigatórios

```
TOOL_DETECTED
TOOL_EXEC_START
TOOL_EXEC_END
RESULT_CREATED
RESULT_QUEUED
RESULT_SEND_START
SUBMIT_VERIFICATION_START
INPUT_FILLED
SUBMIT_ATTEMPT
ENTER_SENT
KIMI_OUTPUT_RESUMED
```

### Implementação

**PENDENTE**

---

## 8. Migration Plan

### Fases

1. **FASE A:** Eliminar reprocessamento do mesmo snapshot ✅
2. **FASE B:** V2 Authority Gate
3. **FASE C:** Impedir raw output de chegar à UI
4. **FASE D:** Tool Result canonicalization
5. **FASE E:** Instrumentar latência
6. **FASE F:** Testar

### Rollback

`LUNA_PROTOCOL=dual` para voltar ao comportamento anterior.

---

## 9. Rollback

### Feature Flags

```
LUNA_PROTOCOL=v2      # Apenas protocolo novo
LUNA_PROTOCOL=dual    # Novo + legacy (migração)
LUNA_PROTOCOL=legacy  # Apenas legacy
```

---

## 10. Testes Obrigatórios

### Teste 1 — TOOL

Uma Tool: `viewDirectory`

Esperado:
- 1 TOOL_START
- 1 TOOL_END
- 0 legacy tool events
- 0 raw response events
- 0 response_delta para Tool

### Teste 2 — RESPONSE

Kimi: `<luna_response>Olá.</luna_response>`

Esperado:
- 1 RESPONSE
- 0 legacy response events
- 0 raw protocol visible
- 1 UI message

### Teste 3 — TOOL + RESPONSE

THINKING → TOOL → RESULT → THINKING → RESPONSE

Esperado:
- THINKING
- TOOL_START
- TOOL_END
- THINKING
- RESPONSE
- DONE

### Teste 4 — DUPLICATED RAW SNAPSHOT

Forçar/extrair o mesmo snapshot várias vezes.

Esperado:
- mesmo hash → apenas UM ToolCall

### Teste 5 — MARKDOWN

Response com Markdown.

Esperado:
- Markdown renderizado normalmente
- Nenhum `<luna_response>` visível

# LUNA — UI EVENT AUDIT

**Data:** 2026-08-16
**Status:** FASE C — AUDITORIA

---

## 1. EVENT FLOW

### Runtime → Frontend

```
luna-soul.cjs (yield)
    ↓
luna-chat-routes.js (SSE)
    ↓
api.js (EventSource)
    ↓
ChatArea.svelte (handleEvent)
    ↓
messages store
    ↓
AssistantMessage / ToolCard / ThinkingBubble
```

---

## 2. PRODUCERS (luna-soul.cjs)

### Semantic Events (should pass to UI)

| Evento | Linha | Descrição |
|--------|-------|-----------|
| `thinking_start` | 2601, 2623, 2759, 6127 | Início do thinking |
| `thinking_delta` | 2602, 2624, 2818, 3604 | Delta incremental do thinking |
| `thinking_update` | 2810, 3597 | Snapshot completo do thinking |
| `response_delta` | 2827, 6141, 6160, 6199, 6211 | Delta incremental da response |
| `response_detected` | 2850, 3037, 3311 | Response completa detectada |
| `response_done` | 2606, 2676, 3118, 6142, 6161, 6200, 6212 | Response finalizada |
| `action_start` | 2604, 2665, 2914, 2931, 2987, 2995, 3642, 3649, 4021, 6178 | Tool iniciada |
| `done` | 2179, 2607, 2677, 3088, 3112, 3140, 3184, 3192, 3216, 3245, 3263, 3297, 3312, 3439, 3520, 3536, 6148, 6167, 6206, 6218 | Stream completo |

### Other Events (need review)

| Evento | Linha | Descrição |
|--------|-------|-----------|
| `system` | 3112, 3192 | Mensagens de sistema |
| `error` | 3184, 3216, 3245, 3263 | Erros |
| `confirmation_required` | 6010 | Confirmação necessária |
| `mode_detected` | 3088 | Modo detectado |

---

## 3. CONSUMERS (ChatArea.svelte)

### Event Handlers

| Evento | Linha | Descrição |
|--------|-------|-----------|
| `thinking_start` | 500 | Cria thinking bubble |
| `thinking_delta` | 519 | Atualiza thinking bubble |
| `thinking_update` | 530 | Substitui thinking bubble |
| `response_delta` | 555 | Buffer response |
| `response_detected` | 578 | Flush response buffer |
| `action_start` | 597 | Cria ToolCard |
| `action_progress` | 745 | Atualiza ToolCard |
| `action_end` | 762 | Finaliza ToolCard |
| `response_done` | 839 | Finaliza response |
| `done` | 858 | Finaliza stream |

---

## 4. UI CONTRACT

### Eventos Permitidos

| Evento | UI Component |
|--------|--------------|
| `thinking_start` | ThinkingBubble |
| `thinking_delta` | ThinkingBubble |
| `thinking_update` | ThinkingBubble |
| `response_delta` | AssistantMessage |
| `response_detected` | AssistantMessage |
| `response_done` | AssistantMessage |
| `action_start` | ToolCard |
| `action_progress` | ToolCard |
| `action_end` | ToolCard |
| `done` | stream complete |

### Eventos NÃO Permitidos

| Evento | Razão |
|--------|-------|
| Raw model chunks | Transporte interno |
| `<luna_tool_call>` | Protocolo interno |
| `</luna_tool_call>` | Protocolo interno |
| `<luna_response>` | Protocolo interno |
| `</luna_response>` | Protocolo interno |
| JSON legacy | Formato antigo |
| DOM mirror | Detecção interna |
| orphan output | Fallback interno |
| UNKNOWN | Não classificado |

---

## 5. RESPONSE CONTRACT

### Contrato Atual

`response_delta` é **INCREMENTAL** (APPEND).

**Evidência:**
```javascript
// ChatArea.svelte:563
responseBuffer += deltaText;
```

**EVIDÊNCIA:**
```javascript
// ChatArea.svelte:563
responseBuffer += deltaText;
```

### Implicações

- Cada `response_delta` adiciona texto ao buffer
- `response_detected` substitui o buffer com texto completo
- `response_done` finaliza a response

---

## 6. TOOL CONTRACT

### Contrato Atual

`action_start` inicia a Tool.
`action_end` finaliza a Tool.

**Evidência:**
```javascript
// ChatArea.svelte:597
case 'action_start': {
  // Cria ToolCard
}
```

---

## 7. PROBLEMAS IDENTIFICADOS

### 7.1 Protocol Tags Não Filtrados

`<luna_tool_call>` e `<luna_response>` não são filtrados antes de chegar à UI.

**Status:** ⚠️ PRECISA CORREÇÃO

### 7.2 Raw Output Pode Chegar à UI

Se o runtime emitir raw output, ele pode chegar à UI sem filtragem.

**Status:** ⚠️ PRECISA CORREÇÃO

### 7.3 Response Truncation

Evidência de Response completa sendo truncada na UI.

**Status:** ⚠️ INVESTIGAR

---

## 8. RECOMENDAÇÕES

### 8.1 UI Event Mapper

Criar uma função central que filtra eventos antes de chegar à UI:

```javascript
function mapRuntimeEventToUiEvent(event) {
  // Bloquear raw output
  if (event.type === 'raw' || event.type === 'unknown') return null;
  
  // Bloquear protocol tags
  if (event.text?.includes('<luna_tool_call>')) return null;
  if (event.text?.includes('<luna_response>')) return null;
  
  // Passar eventos semânticos
  return event;
}
```

### 8.2 Response Truncation

Rastrear exatamente onde a Response é truncada:

```
KIMI RAW → NORMALIZED → SSE → STORE → AssistantMessage
```

---

## 9. PRÓXIMOS PASSOS

1. Implementar UI Event Mapper
2. Filtrar protocol tags
3. Rastrear Response truncation
4. Testar com casos reais

**NÃO implementar sem aprovação.**

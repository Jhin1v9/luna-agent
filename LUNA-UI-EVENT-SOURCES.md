# LUNA — UI EVENT SOURCES

**Data:** 2026-08-16
**Status:** INVENTÁRIO COMPLETO

---

## 1. RESUMO

**Total de yield points:** 114
**Total de tipos de eventos:** 27

---

## 2. EVENTOS POR TIPO

| Tipo | Quantidade | Classificação |
|------|------------|---------------|
| `done` | 20 | PUBLIC_UI |
| `action_start` | 10 | PUBLIC_UI |
| `error` | 8 | PUBLIC_UI |
| `response_done` | 7 | PUBLIC_UI |
| `warning` | 6 | PUBLIC_UI |
| `system` | 6 | PUBLIC_UI |
| `action_end` | 5 | PUBLIC_UI |
| `thinking_start` | 4 | PUBLIC_UI |
| `thinking_delta` | 4 | PUBLIC_UI |
| `response_delta` | 4 | PUBLIC_UI |
| `compact_progress` | 4 | INTERNAL |
| `response_detected` | 3 | PUBLIC_UI |
| `thinking_update` | 2 | PUBLIC_UI |
| `plan_start` | 2 | PUBLIC_UI |
| `login_required` | 2 | PUBLIC_UI |
| `compact_error` | 2 | INTERNAL |
| `assistant` | 2 | PUBLIC_UI |
| `waiting` | 1 | PUBLIC_UI |
| `suggest` | 1 | PUBLIC_UI |
| `plan_error` | 1 | PUBLIC_UI |
| `plan_display` | 1 | PUBLIC_UI |
| `plan_complete` | 1 | PUBLIC_UI |
| `plan_awaiting_approval` | 1 | PUBLIC_UI |
| `mode_detected` | 1 | PUBLIC_UI |
| `meta_start` | 1 | PUBLIC_UI |
| `meta_end` | 1 | PUBLIC_UI |
| `can_steer` | 1 | PUBLIC_UI |

---

## 3. INVENTÁRIO DETALHADO

### 3.1 `thinking_start` (4 ocorrências)

| Linha | Função | Contexto |
|-------|--------|----------|
| 2601 | `processMessageStream` | Debug terminal |
| 2623 | `processMessageStream` | File upload |
| 2790 | `processMessageStream` | Main stream start |
| 6162 | `_telegramPipeline` | Telegram |

### 3.2 `thinking_delta` (4 ocorrências)

| Linha | Função | Contexto |
|-------|--------|----------|
| 2602 | `processMessageStream` | Debug terminal |
| 2624 | `processMessageStream` | File upload |
| 2849 | `processMessageStream` | Main stream (com UI Event Mapper) |
| 6163 | `_telegramPipeline` | Telegram |

### 3.3 `thinking_update` (2 ocorrências)

| Linha | Função | Contexto |
|-------|--------|----------|
| 2841 | `processMessageStream` | Main stream |
| 3630 | `processPlanModeStream` | Plan mode |

### 3.4 `response_delta` (4 ocorrências)

| Linha | Função | Contexto |
|-------|--------|----------|
| 2860 | `processMessageStream` | Main stream (com UI Event Mapper) |
| 6177 | `_telegramPipeline` | Telegram |
| 6215 | `_telegramPipeline` | Telegram error |
| 6227 | `_telegramPipeline` | Telegram success |

### 3.5 `response_detected` (3 ocorrências)

| Linha | Função | Contexto |
|-------|--------|----------|
| 2883 | `processMessageStream` | Legacy response |
| 3070 | `processMessageStream` | V2 protocol response |
| 3344 | `processMessageStream` | V2 protocol response (post-stream) |

### 3.6 `response_done` (7 ocorrências)

| Linha | Função | Contexto |
|-------|--------|----------|
| 2606 | `processMessageStream` | Debug terminal |
| 2676 | `processMessageStream` | File upload |
| 3151 | `processMessageStream` | Main stream completion |
| 6142 | `_telegramPipeline` | Telegram |
| 6161 | `_telegramPipeline` | Telegram |
| 6200 | `_telegramPipeline` | Telegram error |
| 6212 | `_telegramPipeline` | Telegram success |

### 3.7 `action_start` (10 ocorrências)

| Linha | Função | Contexto |
|-------|--------|----------|
| 2604 | `processMessageStream` | Debug terminal |
| 2665 | `processMessageStream` | File upload |
| 2947 | `processMessageStream` | Legacy tool (cached) |
| 2964 | `processMessageStream` | Legacy tool |
| 3020 | `processMessageStream` | V2 protocol tool (cached) |
| 3028 | `processMessageStream` | V2 protocol tool |
| 3677 | `processPlanModeStream` | Plan mode (cached) |
| 3684 | `processPlanModeStream` | Plan mode |
| 4056 | `_processModeStream` | Legacy mode stream |
| 6178 | `_telegramPipeline` | Telegram |

### 3.8 `action_end` (5 ocorrências)

| Linha | Função | Contexto |
|-------|--------|----------|
| 2605 | `processMessageStream` | Debug terminal |
| 2673 | `processMessageStream` | File upload success |
| 2685 | `processMessageStream` | File upload error |
| 4064 | `_processModeStream` | Legacy mode stream |
| 4905 | `_executeActionAsync` | Background execution |

### 3.9 `done` (20 ocorrências)

| Linha | Função | Contexto |
|-------|--------|----------|
| 2179 | `_compactContext` | Compaction error |
| 2607 | `processMessageStream` | Debug terminal |
| 2677 | `processMessageStream` | File upload |
| 3121 | `processMessageStream` | Compaction error |
| 3145 | `processMessageStream` | Stream completion |
| 3173 | `processMessageStream` | User cancel |
| 3217 | `processMessageStream` | Context rebuild error |
| 3225 | `processMessageStream` | User cancel |
| 3249 | `processMessageStream` | Crash recovery error |
| 3278 | `processMessageStream` | Context rebuild error |
| 3296 | `processMessageStream` | Login required |
| 3330 | `processMessageStream` | Empty response |
| 3345 | `processMessageStream` | V2 protocol completion |
| 3472 | `processMessageStream` | Mode completion |
| 3553 | `processMessageStream` | No result |
| 3569 | `processMessageStream` | Iteration limit |
| 3765 | `processPlanModeStream` | Plan mode cancel |
| 3769 | `processPlanModeStream` | Plan mode login |
| 3771 | `processPlanModeStream` | Plan mode error |
| 6148 | `_telegramPipeline` | Telegram |

### 3.10 `system` (6 ocorrências)

| Linha | Função | Contexto |
|-------|--------|----------|
| 3172 | `processMessageStream` | Turn replaced |
| 3223 | `processMessageStream` | User cancel |
| 3234 | `processMessageStream` | Chrome reconnect |
| 3322 | `processMessageStream` | Confirmation wait |
| 3329 | `processMessageStream` | Empty response |
| 3765 | `processPlanModeStream` | Plan mode cancel |

### 3.11 `error` (8 ocorrências)

| Linha | Função | Contexto |
|-------|--------|----------|
| 2686 | `processMessageStream` | File upload error |
| 3120 | `processMessageStream` | Compaction error |
| 3216 | `processMessageStream` | Context rebuild error |
| 3248 | `processMessageStream` | Crash recovery error |
| 3277 | `processMessageStream` | Context rebuild error |
| 3294 | `processMessageStream` | Generic error |
| 3328 | `processMessageStream` | Empty response |
| 3771 | `processPlanModeStream` | Plan mode error |

### 3.12 `warning` (6 ocorrências)

| Linha | Função | Contexto |
|-------|--------|----------|
| 2681 | `processMessageStream` | File upload warning |
| 3367 | `processMessageStream` | Truncated tool |
| 3376 | `processMessageStream` | Unrecognized response |
| 3412 | `processMessageStream` | Incomplete response |
| 3552 | `processMessageStream` | No result |
| 3567 | `processMessageStream` | Iteration limit |

### 3.13 `compact_progress` (4 ocorrências)

| Linha | Função | Contexto |
|-------|--------|----------|
| 1987 | `_compactContext` | Analyzing session |
| 1997 | `_compactContext` | Connecting to Kimi |
| 2002 | `_compactContext` | Creating new thread |
| 2058 | `_compactContext` | Checkpoint sent |

### 3.14 `compact_error` (2 ocorrências)

| Linha | Função | Contexto |
|-------|--------|----------|
| 2110 | `_compactContext` | Compaction error |
| 2162 | `_compactContext` | No user message |

### 3.15 `login_required` (2 ocorrências)

| Linha | Função | Contexto |
|-------|--------|----------|
| 3292 | `processMessageStream` | Login required |
| 3769 | `processPlanModeStream` | Plan mode login |

### 3.16 `can_steer` (1 ocorrência)

| Linha | Função | Contexto |
|-------|--------|----------|
| 2866 | `processMessageStream` | Steer availability |

### 3.17 `waiting` (1 ocorrência)

| Linha | Função | Contexto |
|-------|--------|----------|
| 2870 | `processMessageStream` | Heartbeat |

### 3.18 `mode_detected` (1 ocorrência)

| Linha | Função | Contexto |
|-------|--------|----------|
| 3417 | `processMessageStream` | Mode detection |

### 3.19 `plan_start` (2 ocorrências)

| Linha | Função | Contexto |
|-------|--------|----------|
| 3593 | `processPlanModeStream` | Plan mode start |
| 4079 | `_processModeStream` | Legacy plan start |

### 3.20 `plan_display` (1 ocorrência)

| Linha | Função | Contexto |
|-------|--------|----------|
| 3799 | `processPlanModeStream` | Plan display |

### 3.21 `plan_awaiting_approval` (1 ocorrência)

| Linha | Função | Contexto |
|-------|--------|----------|
| 3800 | `processPlanModeStream` | Plan approval |

### 3.22 `plan_complete` (1 ocorrência)

| Linha | Função | Contexto |
|-------|--------|----------|
| 4435 | `_handlePlanStream` | Plan completion |

### 3.23 `plan_error` (1 ocorrência)

| Linha | Função | Contexto |
|-------|--------|----------|
| 4427 | `_handlePlanStream` | Plan error |

### 3.24 `assistant` (2 ocorrências)

| Linha | Função | Contexto |
|-------|--------|----------|
| 4049 | `_processModeStream` | Legacy response |
| 4072 | `_processModeStream` | Legacy response |

### 3.25 `suggest` (1 ocorrência)

| Linha | Função | Contexto |
|-------|--------|----------|
| 4108 | `_processModeStream` | Suggestion |

### 3.26 `meta_start` (1 ocorrência)

| Linha | Função | Contexto |
|-------|--------|----------|
| 4099 | `_processModeStream` | Meta action start |

### 3.27 `meta_end` (1 ocorrência)

| Linha | Função | Contexto |
|-------|--------|----------|
| 4101 | `_processModeStream` | Meta action end |

---

## 4. CLASSIFICAÇÃO

### PUBLIC_UI (eventos que chegam à UI)

- thinking_start
- thinking_delta
- thinking_update
- response_delta
- response_detected
- response_done
- action_start
- action_end
- done
- system
- error
- warning
- login_required
- can_steer
- waiting
- mode_detected
- plan_start
- plan_display
- plan_awaiting_approval
- plan_complete
- plan_error
- assistant
- suggest
- meta_start
- meta_end

### INTERNAL (eventos que não chegam à UI)

- compact_progress
- compact_error

---

## 5. CAMINHOS RUNTIME → UI

### 5.1 processMessageStream (principal)

```
yield { type: 'thinking_start', sessionId }
yield { type: 'thinking_delta', ... }
yield { type: 'thinking_update', ... }
yield { type: 'response_delta', ... }  ← com UI Event Mapper
yield { type: 'response_detected', ... }
yield { type: 'action_start', ... }
yield { type: 'action_end', ... }
yield { type: 'response_done', ... }
yield { type: 'done', ... }
yield { type: 'system', ... }
yield { type: 'error', ... }
yield { type: 'warning', ... }
yield { type: 'can_steer', ... }
yield { type: 'waiting', ... }
yield { type: 'mode_detected', ... }
yield { type: 'login_required', ... }
```

### 5.2 processPlanModeStream

```
yield { type: 'thinking_update', ... }
yield { type: 'action_start', ... }
yield { type: 'plan_start', ... }
yield { type: 'plan_display', ... }
yield { type: 'plan_awaiting_approval', ... }
yield { type: 'plan_complete', ... }
yield { type: 'plan_error', ... }
yield { type: 'done', ... }
yield { type: 'system', ... }
yield { type: 'error', ... }
yield { type: 'login_required', ... }
```

### 5.3 _telegramPipeline

```
yield { type: 'thinking_start', ... }
yield { type: 'thinking_delta', ... }
yield { type: 'response_delta', ... }
yield { type: 'response_done', ... }
yield { type: 'action_start', ... }
yield { type: 'done', ... }
```

### 5.4 _compactContext

```
yield { type: 'compact_progress', ... }
yield { type: 'compact_error', ... }
```

### 5.5 _processModeStream (legacy)

```
yield { type: 'assistant', ... }
yield { type: 'action_start', ... }
yield { type: 'action_end', ... }
yield { type: 'plan_start', ... }
yield { type: 'meta_start', ... }
yield { type: 'meta_end', ... }
yield { type: 'suggest', ... }
```

### 5.6 _executeActionAsync

```
yield { type: 'action_end', ... }
```

---

## 6. RESPOSTA À PERGUNTA

**"EXISTE ALGUM CAMINHO Runtime → Frontend QUE NÃO PASSA PELO FUTURO emitUiEvent()?"**

**Atualmente:** SIM — existem múltiplos caminhos.

**Após implementação:** NÃO — todos os caminhos devem convergir para `emitUiEvent()`.

---

## 7. PRÓXIMOS PASSOS

1. Criar `emitUiEvent()` como única fronteira
2. Convergir TODOS os yield points para essa função
3. Validar que nenhum caminho bypassa a boundary
4. Documentar contrato de cada evento

# LUNA — EVENT CONTRACTS

**Data:** 2026-08-16
**Status:** FASE 0 — Characterization

---

## 1. RawModelChunk

**Responsabilidade:** Transporte puro. Sem semântica.

```javascript
{
  text: string,           // Conteúdo bruto do modelo
  channel: 'THINKING' | 'OUTPUT',  // Origem do conteúdo
  source: string,         // Fonte: 'extension' | 'network' | 'dom' | 'observer'
  timestamp: number,      // Date.now() quando capturado
  turnId?: string,        // ID do turno (opcional)
  sequence?: number       // Sequência dentro do turno (opcional)
}
```

**Invariantes:**
- `text` nunca é vazio
- `channel` é sempre THINKING ou OUTPUT
- `source` identifica a camada de transporte
- `timestamp` é monotonicamente crescente dentro de um turno

**O que NÃO contém:**
- Informação de Tool
- Informação de Response
- Estado de execução
- DOM nodes
- Playwright references

---

## 2. NormalizedModelEvent

**Responsabilidade:** Representação semântica única do output do modelo.

### 2.1 THINKING

```javascript
{
  type: 'THINKING',
  channel: 'THINKING',
  text: string,           // Texto do thinking
  timestamp: number,
  turnId?: string
}
```

**Invariantes:**
- Sempre vem de channel=THINKING
- Nunca contém Tool ou Response
- Pode conter qualquer texto (incluindo `<luna_tool_call>` como texto)
- Nunca executa

### 2.2 TOOL_CALL

```javascript
{
  type: 'TOOL_CALL',
  channel: 'OUTPUT',
  name: string,           // Nome da tool (ex: 'writeFile')
  arguments: object,      // Argumentos da tool
  toolInstanceId: string, // ID único gerado pelo runtime
  timestamp: number,
  turnId?: string
}
```

**Invariantes:**
- Sempre vem de channel=OUTPUT
- Protocolo completo obrigatório (`<luna_tool_call>...</luna_tool_call>`)
- `name` é obrigatório
- `arguments` é obrigatório (pode ser `{}`)
- `toolInstanceId` é gerado pelo runtime, não pelo modelo

### 2.3 RESPONSE

```javascript
{
  type: 'RESPONSE',
  channel: 'OUTPUT',
  text: string,           // Texto da response (sem wrapper)
  timestamp: number,
  turnId?: string
}
```

**Invariantes:**
- Sempre vem de channel=OUTPUT
- Protocolo completo obrigatório (`<luna_response>...</luna_response>`)
- `text` é o conteúdo SEM os tags de wrapper
- Pode conter Markdown, tabela, código

### 2.4 UNKNOWN

```javascript
{
  type: 'UNKNOWN',
  channel: 'OUTPUT',
  text: string,           // Texto não classificado
  reason: string,         // Razão da não classificação
  timestamp: number,
  turnId?: string
}
```

**Invariantes:**
- Sempre vem de channel=OUTPUT
- Nunca executa
- Pode triggerar repair prompt

---

## 3. ToolCall (para execução)

**Responsabilidade:** Representação normalizada para execução.

```javascript
{
  name: string,
  arguments: object,
  toolInstanceId: string,
  source: 'protocol' | 'legacy',
  timestamp: number
}
```

---

## 4. ToolResult

**Responsabilidade:** Resultado da execução de uma tool.

```javascript
{
  status: 'success' | 'error',
  result: any,            // Resultado da execução
  toolInstanceId: string, // ID da tool que gerou o resultado
  timestamp: number
}
```

**Formato de envelope para envio ao modelo:**
```
<luna_tool_result>
{"status":"success","result":...}
</luna_tool_result>
```

---

## 5. Response (para frontend)

**Responsabilidade:** Representação para exibição no frontend.

```javascript
{
  text: string,           // Markdown puro
  timestamp: number,
  turnId?: string
}
```

**Invariantes:**
- `text` é Markdown puro
- Sem wrapper `<luna_response>`
- Sem JSON de tool
- Sem duplicação

---

## 6. Eventos SSE (para frontend)

| Evento | Payload | Quando |
|--------|---------|--------|
| `thinking_start` | `{}` | Primeiro thinking do turno |
| `thinking_update` | `{fullThinking}` | Thinking cresceu |
| `response_delta` | `{text}` | Response já classificada como RESPONSE |
| `response_detected` | `{text}` | Response completa |
| `action_start` | `{tool, params, toolInstanceId}` | Tool vai executar |
| `action_end` | `{tool, result, toolInstanceId}` | Tool terminou |
| `done` | `{response}` | Turno completo |

**REGRA CRÍTICA:**
`response_delta` só pode ser emitido para conteúdo já classificado como RESPONSE.

---

## 7. Pipeline de Eventos

```
RawModelChunk
    ↓
UnifiedProtocolParser
    ↓
NormalizedModelEvent
    ↓
┌───────────┼───────────┐
↓           ↓           ↓
THINKING  TOOL_CALL   RESPONSE
↓           ↓           ↓
UI        EXECUTOR    UI/DONE
            ↓
        TOOL_RESULT
            ↓
       NEXT_MODEL_TURN
```

---

## 8. Regras de Separação

| Camada | Responsabilidade | Não faz |
|--------|------------------|---------|
| **TRANSPORT** | Observar, extrair, transportar | Interpretar, executar |
| **PROTOCOL** | Classificar, normalizar | Executar, acessar DOM |
| **RUNTIME** | Executar, gerenciar estado | Acessar DOM, interpretar raw |
| **UI** | Apresentar | Executar, interpretar |

---

## 9. Invariantes Globais

1. **Uma única porta de entrada para semântica** — só o UnifiedProtocolParser decide
2. **response_delta só para RESPONSE** — nunca para TOOL ou THINKING
3. **Uma tool por vez** — strictly sequential
4. **Tool Result uma vez** — sem duplicação
5. **Contexto montado uma vez** — sem append implícito
6. **Dedup após normalização** — nunca antes
7. **Legacy como fallback** — V2 é autoridade

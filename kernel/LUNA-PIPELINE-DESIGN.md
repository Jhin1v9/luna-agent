# LUNA — DESIGN DO PIPELINE UNIFICADO DE OUTPUT

**Data:** 2026-08-15
**Status:** DESIGN (não implementado)
**Objetivo:** Redesenhar o pipeline para que Tool e thinking nunca disputem o mesmo stream

---

## 1. Problema Atual

Hoje existem **6 camadas paralelas** de detecção:

1. Chrome Extension (injected.js)
2. Network Interceptor (kimi-bridge.cjs)
3. DOM Structure Poll (kimi-bridge.cjs)
4. JSON Accumulation Buffer (kimi-bridge.cjs)
5. DOM Observer (kimi-bridge.cjs)
6. Final Extraction (kimi-bridge.cjs)

Cada camada pode detectar tools independentemente, causando:
- Duplicação
- Conflitos
- Dependência de estado visual (isGenerating, stop button)
- Tools entrando no thinking

---

## 2. Arquitetura Desejada

```
KIMI RAW STREAM
      ↓
RAW STREAM INGESTOR (múltiplas fontes)
      ↓
UNIFIED PROTOCOL PARSER (única autoridade)
      ↓
NORMALIZED MODEL EVENT
      ↓
┌─────────────┬──────────────┬──────────────┐
│ TOOL_CALL   │ RESPONSE     │ UNKNOWN      │
└──────┬──────┴──────┬───────┴──────┬───────┘
       ↓             ↓              ↓
   EXECUTOR         DONE        FORMAT_RETRY
       ↓
     RESULT
       ↓
   TOOL_RESULT
       ↓
     NOVO TURN
```

---

## 3. Princípios

### 3.1 Thinking é Derivado, não Concorrente

```
ANTES:
thinking primeiro → depois tenta descobrir Tool

DEPOIS:
RAW STREAM → NORMALIZER → MODEL EVENT
                          ├── TOOL
                          ├── RESPONSE
                          ├── THINKING (derivado)
                          └── UNKNOWN
```

### 3.2 DOM é Transporte, não Semântica

```
DOM mudou ≠ Tool
stop button apareceu ≠ Tool
isGenerating=true ≠ Tool
stream_end ≠ Tool

Único que significa Tool:
<luna_tool_call>...</luna_tool_call>
```

### 3.3 Uma Fonte Não Pode Executar Sozinha

```
várias fontes de transporte
        ↓
RAW OUTPUT INGESTOR
        ↓
UM PROTOCOL PARSER
        ↓
UM EXECUTOR
```

---

## 4. Componentes do Novo Pipeline

### 4.1 Raw Stream Ingestor

**Responsabilidade:** Receber stream bruto de múltiplas fontes.

**Fontes:**
- Chrome Extension (injected.js)
- Network Interceptor
- DOM Poll
- JSON Accumulator
- DOM Observer
- Final Extraction

**Saída:** `RawStreamChunk { text, source, timestamp }`

**Regra:** Nenhuma fonte interpreta semanticamente. Apenas transporta.

### 4.2 Unified Protocol Parser

**Responsabilidade:** ÚNICA autoridade semântica.

**Entrada:** `RawStreamChunk`

**Saída:** `NormalizedModelEvent`

**Estados:**
```
IDLE
→ DETECTING
→ TOOL_BUFFERING / RESPONSE_BUFFERING
→ TOOL_COMPLETE / RESPONSE_COMPLETE
→ VALIDATING
→ READY / DONE / UNKNOWN
```

**Reconhece:**
- `<luna_tool_call>...</luna_tool_call>`
- `<luna_response>...</luna_response>`

**Não reconhece:**
- JSON solto sem delimitadores
- Thinking text
- UI text

### 4.3 Normalized Model Event

```javascript
// Tool Call
{
  type: 'TOOL_CALL',
  name: 'writeFile',
  arguments: { path: '...', content: '...' },
  toolId: 'tool_123', // gerado internamente
  timestamp: Date.now()
}

// Response
{
  type: 'RESPONSE',
  text: 'texto da resposta',
  timestamp: Date.now()
}

// Unknown
{
  type: 'UNKNOWN',
  text: '...',
  reason: 'no_valid_protocol',
  timestamp: Date.now()
}
```

### 4.4 Tool Executor

**Responsabilidade:** Executar tools normalizadas.

**Entrada:** `NormalizedToolCall`

**Saída:** `ToolResult`

**Regra:** Recebe SOMENTE do Unified Protocol Parser. Nunca diretamente de detectores.

### 4.5 Response Layer

**Responsabilidade:** Finalizar turno com resposta.

**Entrada:** `NormalizedResponse`

**Saída:** `done` event → `isStreaming=false`

### 4.6 Thinking/UI Layer

**Responsabilidade:** Exibir thinking e UI.

**Entrada:** Conteúdo que NÃO pertence a Tool/Response.

**Regra:** Derivado do output normalizado. Não é parser concorrente.

---

## 5. Fluxo por Turno

```
STATE: WAITING_FOR_MODEL
        ↓
KIMI STREAM (via ingestor)
        ↓
UNIFIED PROTOCOL PARSER
        ↓
STATE: DETECTING
        ↓
┌────────────────────────────┐
│ encontrou protocolo?       │
├───────────────┬────────────┤
│ TOOL          │ RESPONSE   │
└──────┬────────┴──────┬─────┘
       ↓               ↓
  BUFFER TOOL     BUFFER RESPONSE
       ↓               ↓
     END              END
       ↓               ↓
   VALIDATE         VALIDATE
       ↓               ↓
    READY            DONE
       ↓
   EXECUTE
       ↓
   RESULT
       ↓
SEND TOOL RESULT
       ↓
STATE: WAITING_FOR_MODEL
```

---

## 6. Tool Lifecycle

```
1. Parser detecta </luna_tool_call>
2. Valida JSON: name + arguments
3. Gera toolInstanceId internamente
4. Produz NormalizedToolCall
5. Executor recebe
6. Executa via luna-tools.cjs
7. Produz ToolResult
8. Formata: <luna_tool_result>{"status":"success","result":"..."}</luna_tool_result>
9. Envia para Kimi
10. Próximo turno
```

### IDs Internos

| ID | Gerado por | Formato |
|----|------------|---------|
| toolInstanceId | Luna | `tool_${Date.now()}_${random}` |
| sessionId | Luna | UUID |
| turnSeq | Luna | Incremental |

**LLM não fornece IDs.**

---

## 7. Response Lifecycle

```
1. Parser detecta </luna_response>
2. Extrai texto
3. Produz NormalizedResponse
4. Emite: response_detected
5. Emite: done
6. isStreaming=false
7. Fim do turno
```

---

## 8. Unknown Output

```
1. Parser não encontra protocolo válido
2. Turno termina (stream_end ou timeout)
3. Produz UnknownOutput
4. Envia format repair prompt:
   "Use <luna_tool_call> ou <luna_response>"
5. Próximo turno
```

**UNKNOWN não é disparado por chunks intermediários.**

---

## 9. Tool Result

**Formato:**
```
<luna_tool_result>
{"status": "success", "result": "..."}
</luna_tool_result>
```

ou

```
<luna_tool_result>
{"status": "error", "error": "..."}
</luna_tool_result>
```

**Sem:**
- "Próxima ação:"
- Contexto antigo
- Reconstrução da conversa

---

## 10. Deduplicação

**Centralizada no Unified Protocol Parser:**

```
NormalizedToolCall
      ↓
dedup check (toolHash)
      ↓
execute
```

**Preservar:**
- `emittedActionCodes` (bridge)
- `startedToolHashes` (soul)
- `_executedActionCache` (soul)

**Mas todos convergem para o mesmo normalizador.**

---

## 11. Context Architecture

### Primeiro Turno
```
BOOTSTRAP + CURRENT TASK
```

### Tool Result
```
CURRENT TOOL RESULT + mini reminder
```

### Próximo Turno
```
CURRENT TASK + LAST RESULT
```

**Não reconstruir histórico inteiro.**

---

## 12. Prompt Architecture

### Bootstrap (uma vez)
```
Você está conectado a um runtime externo capaz de executar ações.

Para executar uma ação:
<luna_tool_call>
{"name":"tool","arguments":{}}
</luna_tool_call>

Para responder:
<luna_response>
texto
</luna_response>

Após tool result, continue a tarefa.
Uma Tool por turno.
```

### Tool Result (a cada tool)
```
<luna_tool_result>
{"status":"success","result":"..."}
</luna_tool_result>
```

### Format Repair (quando necessário)
```
Use <luna_tool_call> ou <luna_response>
```

**Não repetir bootstrap a cada turno.**

---

## 13. Migração

### Fase 1: Unified Parser
- Criar `UnifiedProtocolParser` como única autoridade
- Múltiplas fontes convergem para ele
- Legacy JSON como fallback

### Fase 2: Extension
- Extension transporta raw stream
- Não interpreta semanticamente
- Entrega chunks para o parser

### Fase 3: Bridge
- Bridge recebe eventos normalizados
- Não precisa de 6 detectores
- Um único caminho: parser → executor

### Fase 4: Soul
- Loop simplificado
- Uma tool por vez
- Contexto mínimo

### Fase 5: Prompt
- Bootstrap curto
- Tool result formatado
- Sem contexto gigante

---

## 14. Arquivos Envolvidos

| Arquivo | Mudança |
|---------|---------|
| `injected.js` | Transportar raw stream, não interpretar |
| `kimi-bridge.cjs` | Receber eventos normalizados, não 6 detectores |
| `luna-soul.cjs` | Loop simplificado, uma tool por vez |
| `LUNA_MASTER_PROMPT.md` | Bootstrap curto |
| `luna-tools.cjs` | Sem mudanças |
| `luna-tool-guard.cjs` | Sem mudanças |

---

## 15. Riscos

| Risco | Mitigação |
|-------|-----------|
| Kimi não obedece protocolo | Fallback legacy |
| Chunks fragmentados | Parser com buffer |
| DOM muda | Protocolo independente de selectors |
| Latência | Parser em tempo real |

---

## 16. Critérios de Sucesso

1. Tool jamais aparece em thinking
2. Tool jamais é executada parcialmente
3. Tool jamais depende de DOM visual
4. Tool jamais depende de stream_end
5. Uma fonte não pode executar Tool sozinha
6. Todos os caminhos convergem para um normalizador
7. Executor tem uma única entrada
8. Tool Result tem uma única representação
9. Contexto não cresce a cada turno
10. Sistema permanece estável se UI da Kimi mudar

---

## 17. Próximos Passos

1. **Este documento é apenas DESIGN** — não implementar ainda
2. **Revisar com o time** — confirmar que a arquitetura faz sentido
3. **Implementar incrementalmente** — fase por fase
4. **Testar cada fase** — não pular validação
5. **Manter fallback** — legacy durante migração

---

**Fim do Design**

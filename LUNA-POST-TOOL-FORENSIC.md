# LUNA — POST-TOOL FORENSIC DEBUG

**Data:** 2026-08-16
**Status:** DIAGNÓSTICO (sem alterações)

---

## 1. TOOL RESULT FLOW

### Pipeline atual

```
ACTION_END
    ↓
result object
    ↓
buildToolResultPrompt() → <luna_tool_result>...</luna_tool_result>
    ↓
_buildContext(sessionId, loopInput, {isToolResult: true})
    ↓
recentEvents (últimos 30 eventos)
    ↓
historyLines (inclui tool_call + tool_result)
    ↓
prompt = toolResult + history
    ↓
sendMessageStream()
    ↓
KIMI
```

### Problema identificado

O tool result aparece **duas vezes** no prompt:

1. Como `userInput` (tool result prompt)
2. Como parte de `historyLines` (dos recentEvents)

**Evidência:** `luna-soul.cjs:4596` — `toolResult: userInput`
**Evidência:** `luna-soul.cjs:4423` — `recentEvents` inclui tool_call e tool_result

---

## 2. DUPLICATION SOURCE

### Fonte 1: recentEvents

`_buildContext` carrega `recentEvents` (últimos 30 eventos) que incluem:
- `tool_call` events
- `tool_result` events

Esses eventos são adicionados a `historyLines` (linhas 4432-4453).

### Fonte 2: userInput

O `userInput` é o tool result prompt gerado por `buildToolResultPrompt()`.

### Resultado

O prompt final contém:
```
{{history}}  ← inclui tool_call + tool_result dos recentEvents
{{toolResult}}  ← o tool result prompt (userInput)
```

Isso causa duplicação.

---

## 3. DOUBLE STRINGIFY

### Evidência

```
"result": "{"name": "readFile", "arguments": {...}}"
```

### Causa provável

O objeto `result` está sendo serializado como string e depois colocado dentro de outro JSON.

### Trace

```
ToolResultObject
    ↓
JSON.stringify (primeira vez)
    ↓
string dentro de wrapper
    ↓
JSON.stringify (segunda vez)
    ↓
envelope final
```

### Localização

`luna-soul.cjs:3172-3178` — outputText é construído com múltiplas camadas:
- `[LUNA-MIRROR]`
- `--- message ---`
- `--- stdout ---`
- `--- stderr ---`
- `--- error ---`

Depois isso é colocado no template `buildToolResultPrompt` que já tem `result: "{{outputText}}"`.

---

## 4. CONTEXT COMPOSITION

### Problema

O contexto está sendo reconstruído a cada turno com:

1. **Primeiro turno:** System prompt + AGENTS + Brain + Workspace + History + Master Prompt
2. **Tool turn:** History (últimos 3 eventos) + Tool Result

Mas `history` já contém o tool_call e tool_result dos `recentEvents`.

### Evidência

`luna-soul.cjs:4558` — `historyLines.slice(isToolResult ? -3 : -10)`

Para tool results, pega os últimos 3 eventos. Mas esses eventos já incluem o tool_call e tool_result.

### Resultado

O prompt do tool turn contém:
```
history:
  - tool: writeFile({...})
  - result: ✅ sucesso...

toolResult:
  <luna_tool_result>{"status":"1/1","tool":"writeFile","result":"..."}</luna_tool_result>
```

O tool result aparece duas vezes!

---

## 5. TASK STATE

### Problema

Quando o usuário envia "oi" depois de uma tarefa pendente, a Kimi interpreta a tarefa anterior como ainda relevante.

### Causa

O `recentEvents` contém a tarefa anterior completa. Quando o usuário envia "oi", o contexto inclui:
- Histórico da tarefa anterior
- Tool calls e results da tarefa anterior
- A nova mensagem "oi"

A Kimi vê tudo isso e decide continuar a tarefa.

### Solução potencial

Diferenciar:
- `CURRENT TASK` (tarefa em execução)
- `CURRENT USER MESSAGE` (mensagem atual do usuário)

Se o usuário envia uma nova mensagem independente, não incluir a tarefa anterior no contexto.

---

## 6. RESPONSE DELIVERY

### Status

A response final está correta semanticamente. A Kimi produziu:
```
<luna_response>
✅ Tarefa concluída...
</luna_response>
```

### Problema potencial

A response pode estar truncada no frontend. Precisa rastrear:
```
KIMI RAW → normalized response → SSE → store → AssistantMessage → Markdown renderer
```

---

## 7. ROOT CAUSES

### RC1: Tool Result Duplicado

**Causa:** `_buildContext` inclui o tool result duas vezes:
1. Como `userInput` (tool result prompt)
2. Como parte de `historyLines` (dos recentEvents)

**Localização:** `luna-soul.cjs:4596` e `luna-soul.cjs:4423-4453`

**Correção:** Não incluir tool_call/tool_result dos recentEvents quando `isToolResult=true`

### RC2: Double Stringify

**Causa:** O objeto `result` está sendo serializado como string e depois colocado dentro de outro JSON.

**Localização:** `luna-soul.cjs:3172-3178` + `buildToolResultPrompt`

**Correção:** Serializar o result apenas uma vez, diretamente no envelope.

### RC3: Contexto Gigante

**Causa:** O contexto inclui System Prompt + AGENTS + Brain + Workspace + History a cada turno.

**Localização:** `luna-soul.cjs:4476-4550` (primeiro turno) e `luna-soul.cjs:4551-4619` (subsequent turns)

**Correção:** Para tool turns, incluir apenas o tool result + estado mínimo necessário.

### RC4: Task State

**Causa:** O `recentEvents` inclui a tarefa anterior completa, mesmo quando o usuário envia uma nova mensagem independente.

**Localização:** `luna-soul.cjs:4423`

**Correção:** Diferenciar `CURRENT TASK` de `CURRENT USER MESSAGE`.

---

## 8. MINIMAL FIXES

### Fix 1: Remover duplicação de Tool Result

**Arquivo:** `luna-soul.cjs`
**Função:** `_buildContext`
**Linha:** 4558

**Correção:** Quando `isToolResult=true`, não incluir tool_call/tool_result dos recentEvents no `historyLines`.

```javascript
// ANTES:
const history = historyLines.slice(isToolResult ? -3 : -10).join('\n');

// DEPOIS:
const filteredHistory = isToolResult 
  ? historyLines.filter(line => !line.startsWith('tool:') && !line.startsWith('result:'))
  : historyLines;
const history = filteredHistory.slice(isToolResult ? -3 : -10).join('\n');
```

### Fix 2: Canonical Tool Result

**Arquivo:** `luna-soul.cjs`
**Função:** `buildToolResultPrompt`

**Correção:** Usar uma estrutura canônica:

```javascript
{
  type: "tool_result",
  toolInstanceId,
  tool,
  status,
  result  // resultado limpo, sem wrapper
}
```

Não incluir:
- raw tool call
- stdout separado
- friendlyMessage separado
- LUNA-MIRROR

### Fix 3: Context mínimo para Tool Turns

**Arquivo:** `luna-soul.cjs`
**Função:** `_buildContext`

**Correção:** Para tool turns, incluir apenas:
- Tool result
- Estado mínimo necessário (workspace path, OS)

Não incluir:
- System prompt completo
- AGENTS.md
- Brain context
- History extenso

---

## 9. PRÓXIMOS PASSOS

1. **Fase A:** Mapear Tool Result flow (CONCLUÍDO)
2. **Fase B:** Mapear Context composition (CONCLUÍDO)
3. **Fase C:** Mapear Task/Turn state (CONCLUÍDO)
4. **Fase D:** Mapear Response delivery (PENDENTE)
5. **Fase E:** Implementar correções (PENDENTE)

**NÃO implementar sem aprovação.**

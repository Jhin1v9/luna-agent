# LUNA — GOLDEN CASES

**Data:** 2026-08-16
**Status:** FASE 0 — Characterization

---

## CASE 01 — Thinking simples

**INPUT:**
```
channel=THINKING
text="O usuário quer criar um arquivo"
```

**EXPECTED:**
- Event: `THINKING`
- Count: 1
- `response_delta`: 0
- `action_start`: 0
- `TOOL_CALL`: 0

---

## CASE 02 — Múltiplos thinking antes da Response

**INPUT:**
```
chunk 1: channel=THINKING text="O usuário quer"
chunk 2: channel=THINKING text="O usuário quer criar um arquivo"
chunk 3: channel=THINKING text="O usuário quer criar um arquivo teste.txt"
chunk 4: channel=OUTPUT text="<luna_response>Arquivo criado</luna_response>"
```

**EXPECTED:**
- `THINKING` events: 3 (ou 1 com texto acumulado)
- `RESPONSE` events: 1
- `response_delta`: apenas para RESPONSE
- `action_start`: 0

---

## CASE 03 — Thinking contendo `<luna_tool_call>` (falso positivo)

**INPUT:**
```
channel=THINKING
text="Vou usar <luna_tool_call> para executar"
```

**EXPECTED:**
- Event: `THINKING`
- `TOOL_CALL`: 0
- `action_start`: 0
- `response_delta`: 0

**REGRA:** Thinking NUNCA executa Tool.

---

## CASE 04 — Tool simples

**INPUT:**
```
channel=OUTPUT
text="<luna_tool_call>{"name":"writeFile","arguments":{"path":"test.txt","content":"OK"}}</luna_tool_call>"
```

**EXPECTED:**
- Event: `TOOL_CALL`
- tool: `writeFile`
- arguments: `{"path":"test.txt","content":"OK"}`
- `response_delta`: 0
- `action_start`: 1

---

## CASE 05 — Tool em vários chunks

**INPUT:**
```
chunk 1: channel=OUTPUT text="<luna_tool_call>"
chunk 2: channel=OUTPUT text={"name":"writeFile",
chunk 3: channel=OUTPUT text="\"arguments\":{\"path\":\"test.txt\"}}"
chunk 4: channel=OUTPUT text="</luna_tool_call>"
```

**EXPECTED:**
- Event: `TOOL_CALL` (após chunk 4)
- `response_delta`: 0 em todos os chunks
- `action_start`: 1 (após chunk 4)

---

## CASE 06 — Tool delimiter dividido entre chunks

**INPUT:**
```
chunk 1: channel=OUTPUT text="<luna_"
chunk 2: channel=OUTPUT text="tool_call>"
chunk 3: channel=OUTPUT text={"name":"writeFile","arguments":{"path":"test.txt","content":"OK"}}
chunk 4: channel=OUTPUT text="</luna_"
chunk 5: channel=OUTPUT text="tool_call>"
```

**EXPECTED:**
- `response_delta`: 0 em TODOS os chunks
- Event: `TOOL_CALL` (após chunk 5)
- `action_start`: 1

---

## CASE 07 — Response simples

**INPUT:**
```
channel=OUTPUT
text="<luna_response>Olá, tudo bem?</luna_response>"
```

**EXPECTED:**
- Event: `RESPONSE`
- text: `Olá, tudo bem?`
- `response_delta`: 1 (com conteúdo da response)
- `action_start`: 0

---

## CASE 08 — Response em vários chunks

**INPUT:**
```
chunk 1: channel=OUTPUT text="<luna_response>"
chunk 2: channel=OUTPUT text="Olá, "
chunk 3: channel=OUTPUT text="tudo bem?"
chunk 4: channel=OUTPUT text="</luna_response>"
```

**EXPECTED:**
- `response_delta`: 0 nos chunks 1-3 (buffering)
- Event: `RESPONSE` (após chunk 4)
- `response_delta`: 1 (com texto completo)
- `action_start`: 0

---

## CASE 09 — Response contendo Markdown

**INPUT:**
```
channel=OUTPUT
text="<luna_response>## Título\n\nTexto com **negrito** e *itálico*</luna_response>"
```

**EXPECTED:**
- Event: `RESPONSE`
- text: `## Título\n\nTexto com **negrito** e *itálico*`
- Markdown preservado

---

## CASE 10 — Response contendo tabela

**INPUT:**
```
channel=OUTPUT
text="<luna_response>| Nome | Valor |\n|---|---|\n| A | 10 |</luna_response>"
```

**EXPECTED:**
- Event: `RESPONSE`
- text: `| Nome | Valor |\n|---|---|\n| A | 10 |`
- Tabela preservada

---

## CASE 11 — Response contendo código

**INPUT:**
```
channel=OUTPUT
text="<luna_response>```javascript\nconsole.log('LUNA');\n```</luna_response>"
```

**EXPECTED:**
- Event: `RESPONSE`
- text: `` ```javascript\nconsole.log('LUNA');\n``` ``
- Código preservado

---

## CASE 12 — Tool com Windows path usando `/`

**INPUT:**
```
channel=OUTPUT
text="<luna_tool_call>{"name":"writeFile","arguments":{"path":"C:/Users/Abner/test.txt","content":"OK"}}</luna_tool_call>"
```

**EXPECTED:**
- Event: `TOOL_CALL`
- path: `C:/Users/Abner/test.txt` (preservado)
- `action_start`: 1

---

## CASE 13 — Tool com Windows path usando `\`

**INPUT:**
```
channel=OUTPUT
text="<luna_tool_call>{"name":"writeFile","arguments":{"path":"C:\\Users\\Abner\\test.txt","content":"OK"}}</luna_tool_call>"
```

**EXPECTED:**
- Event: `TOOL_CALL`
- path: `C:\\Users\\Abner\\test.txt` (preservado após repair)
- `action_start`: 1
- JSON repair: `miniJsonRepair` ou `jsonrepair` deve corrigir

---

## CASE 14 — JSON inválido reparável

**INPUT:**
```
channel=OUTPUT
text="<luna_tool_call>{"name":"writeFile","arguments":{"path":"test.txt","content":"OK"}}</luna_tool_call>"
```

**NOTE:** JSON com trailing comma ou unescaped quotes deve ser reparado pelo mecanismo existente.

**EXPECTED:**
- Event: `TOOL_CALL` (após repair)
- `action_start`: 1

---

## CASE 15 — JSON inválido não reparável

**INPUT:**
```
channel=OUTPUT
text="<luna_tool_call>{invalid json here}</luna_tool_call>"
```

**EXPECTED:**
- Event: `UNKNOWN` ou `luna_unknown_output`
- `action_start`: 0
- Mensagem de erro enviada ao modelo

---

## CASE 16 — Tool Result

**INPUT:**
```
Tool executada: writeFile
Resultado: {"success":true,"path":"test.txt"}
```

**EXPECTED:**
- Tool Result enviado ao modelo UMA VEZ
- Formato: `<luna_tool_result>{"status":"success","result":...}</luna_tool_result>`
- Sem duplicação

---

## CASE 17 — Tool → Tool Result → Thinking → Response

**INPUT:**
```
1. Tool: writeFile
2. Tool Result: success
3. Thinking: "Arquivo criado"
4. Response: "<luna_response>Pronto!</luna_response>"
```

**EXPECTED:**
- `action_start`: 1
- `action_end`: 1
- `THINKING`: 1
- `RESPONSE`: 1
- `response_delta`: 1 (apenas para Response)
- Sequência correta

---

## CASE 18 — Tool → Tool Result → Thinking → Tool → Tool Result → Response

**INPUT:**
```
1. Tool: writeFile
2. Tool Result: success
3. Thinking: "Preciso criar outro"
4. Tool: writeFile
5. Tool Result: success
6. Thinking: "Concluído"
7. Response: "<luna_response>Pronto!</luna_response>"
```

**EXPECTED:**
- `action_start`: 2
- `action_end`: 2
- `THINKING`: 3
- `RESPONSE`: 1
- `response_delta`: 1 (apenas para Response final)
- Zero duplicação

---

## CASE 19 — Mesmo payload reaparecendo por forceResync

**INPUT:**
```
chunk 1: channel=OUTPUT text="<luna_tool_call>..."
chunk 2: channel=OUTPUT text="<luna_tool_call>..." (mesmo conteúdo)
```

**EXPECTED:**
- `action_start`: 1 (não 2)
- Dedup deve prevenir execução duplicada

---

## CASE 20 — Legacy JSON tool

**INPUT:**
```
channel=OUTPUT
text="```json\n{\"tool\":\"writeFile\",\"params\":{\"path\":\"test.txt\"}}\n```"
```

**EXPECTED:**
- Legacy parser deve detectar
- `action_start`: 1
- Compatibilidade mantida durante migração

---

## RESUMO DE EXPECTATIVAS

| Case | THINKING | TOOL_CALL | RESPONSE | response_delta | action_start |
|------|----------|-----------|----------|----------------|--------------|
| 01 | 1 | 0 | 0 | 0 | 0 |
| 02 | 3 | 0 | 1 | 1 | 0 |
| 03 | 1 | 0 | 0 | 0 | 0 |
| 04 | 0 | 1 | 0 | 0 | 1 |
| 05 | 0 | 1 | 0 | 0 | 1 |
| 06 | 0 | 1 | 0 | 0 | 1 |
| 07 | 0 | 0 | 1 | 1 | 0 |
| 08 | 0 | 0 | 1 | 1 | 0 |
| 09 | 0 | 0 | 1 | 1 | 0 |
| 10 | 0 | 0 | 1 | 1 | 0 |
| 11 | 0 | 0 | 1 | 1 | 0 |
| 12 | 0 | 1 | 0 | 0 | 1 |
| 13 | 0 | 1 | 0 | 0 | 1 |
| 14 | 0 | 1 | 0 | 0 | 1 |
| 15 | 0 | 0 | 0 | 0 | 0 |
| 16 | 0 | 0 | 0 | 0 | 0 |
| 17 | 1 | 1 | 1 | 1 | 1 |
| 18 | 3 | 2 | 1 | 1 | 2 |
| 19 | 0 | 1 | 0 | 0 | 1 |
| 20 | 0 | 1 | 0 | 0 | 1 |

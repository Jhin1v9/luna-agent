# LUNA — AUDITORIA DO JSON REPAIR

**Data:** 2026-08-15
**Status:** CONCLUÍDO

---

## 1. Mecanismos Existentes

| Arquivo | Função | Responsabilidade |
|---------|--------|------------------|
| `lib/tool-json-parser.cjs` | `parseToolJson()` | Parser tolerante unificado (strict → jsonrepair → pre-escape → regex → rescue) |
| `lib/tool-json-parser.cjs` | `isBalancedJson()` | Verifica se JSON está balanceado |
| `lib/tool-json-parser.cjs` | `preEscapeJsonStringNewlines()` | Escapa newlines literais dentro de strings |
| `lib/tool-json-parser.cjs` | `extractStringField()` | Extração tolerante de campos string |
| `response-stream-parser.cjs` | `safeJsonParse()` | JSON parse seguro com fallback |
| `luna-soul.cjs` | `tolerantJsonParse()` | Parser tolerante usando jsonrepair |
| `luna-extension/injected.js` | `miniJsonRepair()` | Repair mínimo para extensão (sem bundler) |
| `kimi-bridge.cjs` | `jsonrepair` (npm) | Biblioteca jsonrepair |

---

## 2. Legacy JSON Path

```
Kimi output (JSON code block)
    ↓
cleanWrapperText() — remove fences/headers
    ↓
JSON.parse() — tentativa stricta
    ↓ (se falhar)
jsonrepair() — corrige JSON malformado
    ↓
JSON.parse(repaired)
    ↓
mapParsedObject() — valida schema
    ↓
normalizeParams() — normaliza argumentos
    ↓
Tool Guard → Execute
```

**Função principal:** `parseToolJson()` em `lib/tool-json-parser.cjs`

---

## 3. V2 Path (ANTES da correção)

```
Kimi output (<luna_tool_call>...</luna_tool_call>)
    ↓
injected.js: detectAndEmit()
    ↓
Protocol parser detecta delimitadores
    ↓
TOOL_COMPLETE → PARSE
    ↓
JSON.parse(_protocolBuffer) ← FALHA AQUI!
    ↓
ERROR: "Bad escaped character"
```

**Problema:** O parser V2 usava `JSON.parse` diretamente, sem passar pelo `miniJsonRepair`.

---

## 4. Diferença

| Aspecto | Legacy | V2 (antes) | V2 (depois) |
|---------|--------|------------|-------------|
| JSON parse | jsonrepair → JSON.parse | JSON.parse direto | miniJsonRepair → JSON.parse |
| Backslash handling | Sim | Não | Sim |
| Truncated JSON | Sim | Não | Sim |
| Unescaped quotes | Sim | Não | Sim |

---

## 5. Melhor Ponto de Integração

**Função:** `miniJsonRepair()` em `injected.js:526`

Já existe no `injected.js` e é usada pelo parser legacy. O parser V2 agora a utiliza antes do `JSON.parse`.

---

## 6. Raw Payload Dedup

O `hashString()` em `injected.js` gera hash do conteúdo. O `forceResync` pode reenviar o mesmo payload se o hash não mudou.

**Recomendação:** Adicionar dedup por hash antes do parser V2.

---

## 7. ForceResync

O `forceResync` é ativado pelo heartbeat (600ms). Se o payload não mudou, não deveria reprocessar.

**Status:** Não implementado no V2 ainda.

---

## 8. Recomendação

A menor mudança arquitetural possível:

1. ✅ Usar `miniJsonRepair()` antes de `JSON.parse` no parser V2
2. ✅ Atualizar System Prompt com regra de caminhos Windows
3. Adicionar dedup por hash no parser V2 (futuro)

---

## 9. Correções Implementadas

1. **`injected.js`** — Parser V2 agora usa `miniJsonRepair()` antes de `JSON.parse`
2. **`LUNA_MASTER_PROMPT.md`** — Adicionada regra de caminhos Windows
3. **`manifest.json`** — Versão atualizada para 2.9.7

---

## 10. Resposta à Pergunta Principal

**"Qual mecanismo existente da Luna deveria processar o payload `<luna_tool_call>` antes da validação, e por que ele não está sendo chamado hoje?"**

**Resposta:** O `miniJsonRepair()` em `injected.js:526` deveria processar o payload. Ele não estava sendo chamado porque o parser V2 usava `JSON.parse` diretamente. Agora foi corrigido.

# LUNA — PHASE 0 BASELINE

**Data:** 2026-08-16
**Status:** FASE 0 — Characterization

---

## 1. TEST HARNESS

**Arquivo:** `docs/refactor/golden-cases.md`
**Contratos:** `docs/refactor/event-contracts.md`
**Baseline:** `docs/refactor/PHASE-0-BASELINE.md` (este arquivo)

**Framework de testes:** A definir (verificar package.json do projeto)

---

## 2. GOLDEN CASES

**Total:** 20 casos
**Cobertura:**
- Thinking: 3 casos (01, 02, 03)
- Tool: 7 casos (04, 05, 06, 12, 13, 14, 15)
- Response: 5 casos (07, 08, 09, 10, 11)
- Tool Result: 1 caso (16)
- Integração: 2 casos (17, 18)
- Dedup: 1 caso (19)
- Legacy: 1 caso (20)

---

## 3. EVENT CONTRACTS

**Documentados em:** `docs/refactor/event-contracts.md`

| Contrato | Status |
|----------|--------|
| RawModelChunk | Definido |
| NormalizedModelEvent | Definido |
| ToolCall | Definido |
| ToolResult | Definido |
| Response | Definido |

---

## 4. CURRENT BEHAVIOR (baseline observado)

### 4.1 Pipeline atual

```
KIMI → DOM/Extension → Bridge → Soul → Frontend
```

### 4.2 response_delta pontos

| Arquivo | Quantidade |
|---------|------------|
| injected.js | 0 (usa stream_state) |
| kimi-bridge.cjs | 9 |
| luna-soul.cjs | 6 |
| **Total** | **15** |

### 4.3 action_detected pontos

| Arquivo | Quantidade |
|---------|------------|
| injected.js | 6 |
| kimi-bridge.cjs | 15 |
| luna-soul.cjs | 26 |
| **Total** | **47** |

### 4.4 Parsers

| Arquivo | Quantidade |
|---------|------------|
| injected.js | 6 |
| kimi-bridge.cjs | 16 |
| luna-soul.cjs | 11 |
| **Total** | **33** |

### 4.5 Dedup mechanisms

| Arquivo | Quantidade |
|---------|------------|
| injected.js | 11 |
| kimi-bridge.cjs | 12 |
| luna-soul.cjs | 12 |
| **Total** | **35** |

---

## 5. KNOWN FAILURES

### 5.1 Partial delimiter vazando como response_delta

**Status:** CORRIGIDO (v2.10.0)
**Evidência:** `</luna_tool_call>` sendo emitido como response_delta

### 5.2 Tool call em thinking sendo executado

**Status:** PREVENIDO (channel=THINKING nunca executa)
**Evidência:** Nenhum caso reportado após correção de channel

### 5.3 Response com wrapper `<luna_response>`

**Status:** CORRIGIDO (wrapper stripping)
**Evidência:** Response agora chega sem wrapper ao frontend

### 5.4 Tool Result duplicado

**Status:** IDENTIFICADO (não corrigido ainda)
**Evidência:** Múltiplos wraps no pipeline

### 5.5 Contexto gigante

**Status:** IDENTIFICADO (não corrigido ainda)
**Evidência:** System prompt + AGENTS + Brain + Workspace + History a cada turno

---

## 6. BASELINE METRICS

### 6.1 Latência (observada)

| Métrica | Valor |
|---------|-------|
| TOOL_COMPLETE → ACTION_START | ~100ms |
| ACTION_END → TOOL_RESULT_SENT | ~50ms |
| TOOL_RESULT_SENT → NEXT_MODEL_OUTPUT | ~35s (Kimi thinking) |

### 6.2 Duplicações (observadas)

| Métrica | Valor |
|---------|-------|
| action_start por Tool | 1 (com dedup) |
| response_detected | 1 |
| response_delta | 1-3 (varia) |

### 6.3 Tamanho de prompt

| Métrica | Valor |
|---------|-------|
| Primeiro turno | ~2000 chars (estimativa) |
| Tool turn | ~500 chars (estimativa) |
| Response turn | ~300 chars (estimativa) |

**NOTA:** Medir com precisão em teste real.

---

## 7. NON-NEGOTIABLE BEHAVIORS

1. **Thinking nunca executa Tool** — channel=THINKING é sagrado
2. **Tool em OUTPUT só com protocolo completo** — `<luna_tool_call>...</luna_tool_call>`
3. **Response em OUTPUT só com protocolo completo** — `<luna_response>...</luna_response>`
4. **response_delta só para RESPONSE** — nunca para TOOL ou THINKING
5. **Uma tool por vez** — strictly sequential
6. **Tool Result uma vez** — sem duplicação
7. **Legacy funciona durante migração** — feature flag `dual`
8. **JSON repair usa mecanismo existente** — não criar novo
9. **Partial delimiter não vira response** — bufferizar até classificação
10. **Dedup após normalização** — nunca antes

---

## 8. PRÓXIMOS PASSOS

1. **Fase 0** — Este documento (CONCLUÍDO)
2. **Fase 1** — NormalizedModelEvent + Protocol Contract
3. **Fase 2** — Unified Protocol Parser
4. **Fase 3** — Transport Adapter
5. **Fase 4** — Runtime Loop
6. **Fase 5** — Context / Prompt Layer
7. **Fase 6** — Unify & Disable Legacy
8. **Fase 7** — Delete Dead Code

**NÃO iniciar Fase 1 sem aprovação.**

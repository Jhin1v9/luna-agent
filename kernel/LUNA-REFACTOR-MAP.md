# LUNA — REFACTOR MAP

**Data:** 2026-08-16
**Status:** FASE 0 CONCLUÍDA — Pronto para Fase 1

---

## ORDEM DE MIGRAÇÃO (ATUALIZADA)

### Fase 0 — Characterization / Golden Tests ✅
- Golden cases: `docs/refactor/golden-cases.md`
- Event contracts: `docs/refactor/event-contracts.md`
- Baseline: `docs/refactor/PHASE-0-BASELINE.md`

### Fase 1 — Protocol Contracts + Unified Events
- Criar RawModelChunk
- Criar NormalizedModelEvent
- Definir invariantes
- Testar golden cases com contratos

### Fase 2 — Pure Protocol Parser
- Criar UnifiedProtocolParser
- Estados: IDLE → DETECTING → TOOL_BUFFERING/RESPONSE_BUFFERING → COMPLETE
- Partial delimiters
- Fragmentação
- JSON repair via mecanismo existente

### Fase 3 — Transport Adapter
- Simplificar injected.js
- injected.js: OBSERVE → EXTRACT → EMIT RAW
- Mover parsers para lib/ (se compatível com browser)
- Manter legacy como fallback

### Fase 4 — Runtime Loop
- Runtime recebe NormalizedModelEvent
- Uma tool por vez
- Tool Result uma vez
- response_delta só para RESPONSE

### Fase 5 — Context / Prompt Layer
- Eliminar contexto repetido
- buildBootstrap() / buildToolResultTurn() / buildRepairTurn()
- Contexto montado uma vez

### Fase 6 — Unify & Disable Legacy
- Feature flags: legacy / dual / v2
- Desabilitar individualmente
- Medir antes de remover

### Fase 7 — Delete Dead Code
- Remover após prova
- Rollback por fase

---

## REGRA DE OURO

> **Só existe UMA porta de entrada para a semântica.**

Não importa se vier da extensão, network ou DOM. Tudo vira `RawModelChunk`, e só o `UnifiedProtocolParser` pode decidir o significado.

---

## 1. TODOS OS DETECTORES ATUAIS

### injected.js (35 funções)

| Detector | Tipo | Responsabilidade |
|----------|------|------------------|
| `findThinkingContainer()` | DOM | Localiza container de thinking |
| `extractThinking()` | DOM | Extrai texto de thinking |
| `extractResponse()` | DOM | Extrai texto de response |
| `detectJsonBlocks()` | Legacy | Escaneia code blocks para JSON |
| `detectButtonState()` | DOM | Detecta botão send/stop |
| `findProtocolStart()` | Parser | Encontra delimiter de abertura |
| `findPartialMatch()` | Parser | Encontra partial delimiter |
| `findProtocolClose()` | Parser | Encontra delimiter de fechamento |
| `detectAndEmit()` | Runtime | Loop principal de detecção |

### kimi-bridge.cjs (10.281 linhas)

| Detector | Tipo | Responsabilidade |
|----------|------|------------------|
| `_extractResponse()` | Runtime | Extração multi-estratégia |
| `_extractFinalThinking()` | DOM | Extrai thinking final |
| `_extractJsonToolCalls()` | Parser | Extrai tool calls de texto |
| `_extractJsonBlocksFromDOM()` | DOM | Extrai JSON de code blocks |
| `_extractToolMirrorFromDOM()` | DOM | Extrai ipython/bash blocks |
| `_pollThinkingAndResponse()` | DOM | Poll de thinking/response |
| `_checkCompletionCandidate()` | Runtime | Detector de conclusão |
| `_detectUiState()` | DOM | Detecta estado da UI |

### luna-soul.cjs (6.364 linhas)

| Detector | Tipo | Responsabilidade |
|----------|------|------------------|
| `parseKimiResponse()` | Parser | Parser multi-estratégia (7 estratégias) |
| `parseTagResponse()` | Parser | Parser de tags `[[response]]`/`[[action]]` |
| `_tryExtractRawToolJson()` | Parser | Backstop para JSON raw |
| `isJsonResponseComplete()` | Parser | Verifica completude de JSON |
| `isIncompleteResponse()` | Parser | Detecta response incompleta |

---

## 2. TODOS OS PONTOS DE response_delta

### injected.js (0 eventos response_delta)

Emite `stream_state` com campo `response` em vez de `response_delta`.

| Linha | Evento | Contexto |
|-------|--------|----------|
| 968 | `stream_state` | Response mudou |

### kimi-bridge.cjs (9 pontos de yield)

| # | Linha | Source | Trigger |
|---|-------|--------|---------|
| 1 | 9176 | state_change/prose-prefix | Texto antes de JSON wrapper |
| 2 | 9189 | json_accumulator/overflow | Acumulador >40 chars sem wrapper |
| 3 | 9200 | json_buffer/response | JSON wrapper `{"response":...}` completo |
| 4 | 9226 | json_buffer/response | JSON pequeno instantaneamente completo |
| 5 | 9242 | state_change/plain | Texto plano (sem JSON) |
| 6 | 9253 | state_change/shrink | DOM encolheu |
| 7 | 9399 | response_delta/cursor | Evento direto do observer/extensão |
| 8 | 9540 | json_buffer/orphan | Acumulador órfão no fim do stream |
| 9 | 9549 | json_buffer/orphan-fallback | Fallback raw do acumulador órfão |

### luna-soul.cjs (6 pontos de handling)

| # | Linha | Contexto |
|---|-------|----------|
| 1 | 2833 | Main stream loop |
| 2 | 3620 | Plan mode |
| 3 | 6157 | Telegram CHAT response |
| 4 | 6176 | Telegram tool fallback |
| 5 | 6215 | Telegram tool error |
| 6 | 6227 | Telegram tool success |

---

## 3. TODOS OS PONTOS DE action_detected

### injected.js (6 eventos equivalentes)

| # | Linha | Evento | Contexto |
|---|-------|--------|----------|
| 1 | 800 | `tool_call_detected` | Legacy pós-stream-end |
| 2 | 997 | `luna_tool_start` | Protocol buffering iniciado |
| 3 | 1026 | `luna_tool_start` | Protocol buffering (delimiter completo) |
| 4 | 1072 | `luna_tool_call_complete` | Tool validada |
| 5 | 1081 | `tool_call_detected` | Backward-compat |
| 6 | 1147 | `tool_response_detected` | Legacy JSON response |

### kimi-bridge.cjs (15 pontos de yield)

| # | Linha | Source | Trigger |
|---|-------|--------|---------|
| 1 | 9058 | drain/hard-cancel | Hard cancel drain |
| 2 | 9289 | delimited_protocol | `<luna_tool_call>` detectado |
| 3 | 9298 | dom_mirror | ipython code block |
| 4 | 9308 | generic | Outras fontes |
| 5 | 9202 | json_buffer/tool | JSON `{"tool":...}` completo |
| 6 | 9205 | json_buffer/script | JSON `{"script":...}` completo |
| 7 | 9227 | json_buffer/tool | JSON pequeno completo |
| 8 | 9230 | json_buffer/script | JSON pequeno completo |
| 9 | 9254 | json_buffer/shrink/tool | DOM encolheu com tool |
| 10 | 9258 | json_buffer/shrink/script | DOM encolheu com script |
| 11 | 9520 | post_close_drain | Drain pós-conclusão |
| 12 | 9542 | json_buffer/orphan/tool | Acumulador órfão tool |
| 13 | 9545 | json_buffer/orphan/script | Acumulador órfão script |
| 14 | 9741 | final_poll/tool | Final poll tool |
| 15 | 9815 | late_scan | Scan tardio |

### luna-soul.cjs (26 pontos de emissão)

| # | Source | Linha | Trigger |
|---|--------|-------|---------|
| 1 | /debug | 2608 | Slash command |
| 2 | File upload | 2669 | Bridge file send |
| 3 | action_detected | 2944 | DOM mirror tool |
| 4 | Cached replay | 2927 | Dedup cache hit |
| 5 | luna_tool_call_complete | 3008 | v2 protocol tool |
| 6 | Cached replay v2 | 3000 | v2 dedup cache hit |
| 7 | _processModeStream | 4034 | Legacy mode stream |
| 8 | _processModeResult | 4176 | Non-stream mode |
| 9 | _processModeResult SCRIPT | 4358 | Non-stream script |
| 10 | Plan mode | 3662 | Plan tool |
| 11 | Plan mode cached | 3655 | Plan dedup cache |
| 12 | Telegram | 6194 | Telegram dashboard tool |

---

## 4. TODOS OS PARSERS

### injected.js (6 parsers)

| Parser | Linha | Tipo |
|--------|-------|------|
| `extractFirstJsonObject()` | 483 | JSON |
| `miniJsonRepair()` | 526 | JSON repair |
| `parseJsonBlock()` | 561 | JSON wrapper |
| `findProtocolStart()` | 691 | Protocol |
| `findPartialMatch()` | 710 | Protocol |
| `findProtocolClose()` | 721 | Protocol |

### kimi-bridge.cjs (16 parsers)

| Parser | Linha | Tipo |
|--------|-------|------|
| `looksLikeJsonStart()` | 155 | JSON detection |
| `isTinyJsonFragment()` | 175 | JSON detection |
| `isJsonComplete()` | 181 | JSON completeness |
| `extractFirstCompleteJsonObject()` | 227 | JSON extraction |
| `findMidTextJsonWrapperStart()` | 270 | JSON split |
| `extractWriteFileFromText()` | 282 | Specialized |
| `extractResponseFromCompleteJson()` | 475 | Unified parser |
| `_extractResponseFromCompleteJsonLegacy()` | 498 | Legacy |
| `_preEscapeJsonStringNewlines()` | 430 | JSON utility |
| `_extractJsonToolCalls()` | 8174 | Tool extraction |
| `_extractParsedText()` | 8260 | Text cleaning |
| `tolerantJsonParse()` | 8022 | Browser-side |
| `tryParseResponseJson()` | 7127 | Browser-side |
| `tryParseToolJson()` | 7106 | Browser-side |
| `tryParseToolJson()` | 3020 | Node-side |
| `parseToolJson` (imported) | 32 | Unified tolerant |

### luna-soul.cjs (7 parsers + 4 imported)

| Parser | Linha | Tipo |
|--------|-------|------|
| `tolerantJsonParse()` | 68 | Tolerant |
| `parseKimiResponse()` | 522 | Multi-estratégia |
| `parseTagResponse()` | 732 | Tag-based |
| `_tryExtractRawToolJson()` | 473 | Backstop |
| `isJsonResponseComplete()` | 1008 | Completeness |
| `isIncompleteResponse()` | 1024 | Auto-healing |
| `_stripJsonResponseWrapper()` | 3846 | Wrapper strip |
| `ResponseStreamParser` (imported) | 36 | Stream parser |
| `parseToolJson` (imported) | 42 | Unified tolerant |
| `normalizeParams` (imported) | 43 | Dedup key |
| `jsonrepair` (imported) | 57 | JSON repair |

---

## 5. TODOS OS DEDUPS

### injected.js (11 dedups)

| Dedup | Escopo | Mecanismo |
|-------|--------|-----------|
| `_detectedToolKeys` | Per-bubble | Map<key, node> |
| `_detectedResponseKeys` | Per-bubble | Map<hash, node> |
| `getToolKey()` | Key generation | tool::paramsJSON |
| `cleanupDedup()` | TTL pruning | 300 cap |
| `hashString()` | Utility | djb2 hash |
| `seen` Set | Per-call | Text dedup |
| `_thinkingStartedEmitted` | Per-turn | Boolean |
| `_streamEndEmitted` | Per-turn | Boolean |
| `_protocolDetectedThisTurn` | Per-turn | Boolean |
| `_expandedThinkingContainers` | Per-container | WeakSet |
| `_lastSentThinking/_lastSentResponse` | Per-poll | Change detection |

### kimi-bridge.cjs (12 dedups)

| Dedup | Escopo | Mecanismo |
|-------|--------|-----------|
| `emittedActionCodes` | Per-stream | SHA-256 Set |
| `emittedResponseHashes` | Per-stream | SHA-256 Set |
| `emittedJsonActionHashes` | Per-stream | Dead code (REMOVER) |
| `session._domEventSeen` | Per-session | Content-hash TTL 2s |
| `_dedupKeyForAction()` | Method | SHA-256 builder |
| `buildJsonBufferAction()` | Per-stream | Via emittedActionCodes |
| `makeDomEventDedupKey()` | Cross-source | lib/tool-dedup-key.cjs |
| `seenResponseTexts` | Per-poll | Browser-side Set |
| `seenMarkdownTexts` | Per-poll | Browser-side Set |
| `foundKeys` | Per-call | Multi-strategy dedup |
| `responseCursor/thinkingCursor` | Per-stream | Watermark cursors |
| `turnEndSignalCounts` | Per-stream | Consensus voting |

### luna-soul.cjs (12 dedups)

| Dedup | Escopo | Mecanismo |
|-------|--------|-----------|
| `startedToolHashes` | Per-turn | SHA-256 Set |
| `_executedActionCache` | Per-session | Map of Maps, 60s TTL, 200 cap |
| `_getRecentActionResult()` | Runtime | Cache check + fedBack flag |
| `_markActionExecuted()` | Runtime | Cache store |
| `skipModeExecution` | Post-stream | Gate |
| `allCached` | Post-stream | Guard |
| Per-turn dedup in `_processModeResult` | Mode result | Cache check |
| `v2ResponseHandled` | Per-turn | Boolean flag |
| `checkAlreadySent` | Per-message | Retry guard |
| `emittedActionCodes` (bridge) | Per-stream | Bridge-level |
| `executedDomActionHashes` (bridge) | Per-message | Bridge-level |

---

## 6. TODAS AS FONTES DE RAW OUTPUT

| Fonte | Prioridade | Arquivo | Descrição |
|-------|------------|---------|-----------|
| Chrome Extension | 0 (highest) | kimi-bridge:6136 | `_consumeExtensionEvents()` |
| ProviderNetworkInterceptor | 1 | kimi-bridge:867 | HTTP response capture via CDP |
| Legacy JS-injected stream | 1b (deprecated) | kimi-bridge:5869 | `window.__lunaStream` |
| DOM structure extraction | 2.5 | kimi-bridge:7078 | `_pollThinkingAndResponse()` |
| Generic provider extraction | 3 | kimi-bridge:2844 | `_genericProviderExtraction()` |
| Snapshot diff | Final | kimi-bridge:2328 | `_extractResponseDiff()` |
| DOM observer | Secondary | kimi-bridge:6592 | MutationObserver |
| DOM mirror | Fallback | kimi-bridge:7631 | ipython/bash blocks |
| JSON blocks from DOM | Fallback | kimi-bridge:7898 | JSON code blocks |

---

## 7. FUNÇÕES QUE PODEM SER REMOVIDAS

| Função | Arquivo | Linha | Razão |
|--------|---------|-------|-------|
| `emittedJsonActionHashes` | kimi-bridge | 8953 | Dead code |
| `extractWriteFileFallback` | kimi-bridge | 2945 | Duplicata de extractWriteFileFromText |
| Legacy JS-injected stream | kimi-bridge | 5869-5911 | Deprecated |
| `_scrubSecrets` | luna-soul | 1913 | Identity function, disabled |
| `_scrubSecretsDisabled` | luna-soul | 1917 | Unused |

---

## 8. FUNÇÕES QUE DEVEM PERMANECER

### injected.js (26 funções DOM-coupled)

Todas as funções de DOM access, text extraction, emit layer, bootstrap/lifecycle.

### kimi-bridge.cjs (core)

Todas as detection functions, event emission points, dedup mechanisms, raw output sources, parsers.

### luna-soul.cjs (core)

Runtime/Orchestration, Compaction, Safety/Confirmation, EventBus, TurnManager.

---

## 9. FUNÇÕES QUE DEVEM VIRAR TRANSPORT-ONLY

### injected.js

| Função | Atual | Proposto |
|--------|-------|----------|
| `extractFirstJsonObject()` | Parser em injected | Mover para `lib/` |
| `miniJsonRepair()` | Parser em injected | Mover para `lib/` |
| `parseJsonBlock()` | Parser em injected | Mover para `lib/` |
| `findProtocolStart()` | Parser em injected | Mover para `lib/` |
| `findPartialMatch()` | Parser em injected | Mover para `lib/` |
| `findProtocolClose()` | Parser em injected | Mover para `lib/` |
| `generateToolId()` | Utility em injected | Mover para `lib/` |
| `getToolKey()` | Dedup em injected | Mover para `lib/` |
| `hashString()` | Utility em injected | Mover para `lib/` |

### luna-soul.cjs

| Função | Atual | Proposto |
|--------|-------|----------|
| `tolerantJsonParse()` | Parser em soul | Mover para `lib/tool-json-parser.cjs` |
| `parseKimiResponse()` | Parser em soul | Mover para `response-parser.cjs` |
| `parseTagResponse()` | Parser em soul | Mover para `response-parser.cjs` |
| `_tryExtractRawToolJson()` | Parser em soul | Mover para `response-parser.cjs` |
| `isJsonResponseComplete()` | Parser em soul | Mover para `response-parser.cjs` |
| `isIncompleteResponse()` | Parser em soul | Mover para `response-parser.cjs` |
| `buildSystemPrompt()` | Context em soul | Mover para `prompt-builder.cjs` |
| `buildToolResultPrompt()` | Context em soul | Mover para `prompt-builder.cjs` |
| `buildMiniReminder()` | Context em soul | Mover para `prompt-builder.cjs` |
| `loadSkillIndex()` | Context em soul | Mover para `skill-loader.cjs` |
| `loadPersona()` | Context em soul | Mover para `persona-loader.cjs` |
| `loadMemories()` | Context em soul | Mover para `memory-loader.cjs` |
| `loadAgentsMd()` | Context em soul | Mover para `agents-md-loader.cjs` |
| `_telegram*` methods | Telegram em soul | Mover para `telegram-pipeline.cjs` |
| `MetaExecutor` | Class em soul | Mover para `meta-executor.cjs` |
| `ProjectHealthValidator` | Class em soul | Mover para `project-health-validator.cjs` |
| `EventBus` | Class em soul | Mover para `lib/event-bus.cjs` |
| `TurnManager` | Class em soul | Mover para `lib/turn-manager.cjs` |

---

## 10. ARQUITETURA FINAL PROPOSTA

```
                  KIMI WEB
                     │
                     ▼
              ┌─────────────┐
              │  TRANSPORT  │
              │ extension   │
              │ CDP / DOM   │
              └──────┬──────┘
                     │
                RawModelChunk
                {text, channel, source, timestamp}
                     │
                     ▼
          ┌──────────────────────┐
          │ UnifiedProtocolParser│
          │ (lib/protocol-parser)│
          └──────────┬───────────┘
                     │
          ┌──────────┼───────────┐
          ▼          ▼           ▼
      THINKING    TOOL_CALL    RESPONSE
          │          │           │
          ▼          ▼           ▼
         UI       EXECUTOR      DONE
                     │
                  TOOL_RESULT
                     │
                     ▼
                    KIMI
```

### Camadas

| Camada | Responsabilidade | Arquivos |
|--------|------------------|----------|
| **TRANSPORT** | Observar, extrair, transportar | injected.js, content.js, background.js |
| **PROTOCOL** | Interpretar, classificar | lib/protocol-parser.cjs |
| **RUNTIME** | Executar, gerenciar estado | luna-soul.cjs |
| **UI** | Apresentar | luna-web (Svelte) |

### Regras

1. TRANSPORT não interpreta
2. PARSER interpreta
3. RUNTIME executa
4. UI apresenta
5. Nenhuma camada pula etapas

---

## 11. ORDEM SEGURA DE MIGRAÇÃO

### Fase 1: Extrair parsers (baixo risco)

1. Criar `lib/protocol-parser.cjs` com funções de protocolo de injected.js
2. Criar `response-parser.cjs` com parsers de luna-soul.cjs
3. Criar `prompt-builder.cjs` com funções de contexto de luna-soul.cjs
4. Criar `context-loaders.cjs` com loaders de luna-soul.cjs

### Fase 2: Simplificar injected.js (médio risco)

1. Mover parsers para `lib/`
2. injected.js fica apenas: OBSERVE → EXTRACT → EMIT RAW
3. Protocol parser roda no bridge/soul, não no browser

### Fase 3: Unificar detecção (alto risco)

1. Eliminar fontes duplicadas de detecção
2. Uma única fonte de truth para cada evento
3. Dedup centralizado após normalização

### Fase 4: Remover legacy (controlado)

1. Feature flag `LUNA_PROTOCOL=v2`
2. Legacy adapter para backward compat
3. Data/critério para morrer

---

## 12. PLANO DE ROLLBACK

### Por fase

| Fase | Rollback |
|------|----------|
| Fase 1 | Reverter extração de módulos |
| Fase 2 | Restaurar parsers em injected.js |
| Fase 3 | Restaurar fontes duplicadas |
| Fase 4 | `LUNA_PROTOCOL=dual` |

### Feature flags

```
LUNA_PROTOCOL=v2      # Apenas protocolo novo
LUNA_PROTOCOL=dual    # Novo + legacy (migração)
LUNA_PROTOCOL=legacy  # Apenas legacy
```

### Critério de sucesso

- 10 cenários de validação passando
- Latência < 200ms para tool execution
- Zero duplicações
- Response completa no frontend
- Thinking/Tool/Response separados corretamente

---

## 13. ESTATÍSTICAS

| Categoria | injected.js | kimi-bridge.cjs | luna-soul.cjs | Total |
|-----------|-------------|-----------------|---------------|-------|
| Funções | 35 | ~100 | ~141 | ~276 |
| Parsers | 6 | 16 | 11 | 33 |
| Dedups | 11 | 12 | 12 | 35 |
| response_delta pontos | 0 | 9 | 6 | 15 |
| action_detected pontos | 6 | 15 | 26 | 47 |
| Fontes raw output | 0 | 9 | 0 | 9 |

---

## 14. PROBLEMAS IDENTIFICADOS

1. **6 detectores competindo** — extension, network, DOM poll, JSON accumulator, DOM observer, final extraction
2. **response_delta emitido antes do parser** — partial delimiter vazando
3. **Parser rodando no browser** — injected.js faz parsing semântico
4. **Dedup espalhada** — 35 mecanismos em 3 arquivos
5. **Legacy com parser próprio** — parseKimiResponse + parseTagResponse + _tryExtractRawToolJson
6. **Contexto gigante** — System prompt + AGENTS + Brain + Workspace + History a cada turno
7. **Tool Result duplicado** — múltiplos wraps no pipeline

---

## 15. PRÓXIMOS PASSOS

1. **Aprovar este mapa** — sem alterações de código
2. **Fase 1** — Extrair parsers para `lib/`
3. **Fase 2** — Simplificar injected.js
4. **Fase 3** — Unificar detecção
5. **Fase 4** — Remover legacy

**Não implementar sem aprovação.**

# Luna Status

> Living memory for AI agents. Update this file when system reality changes.
> Last verified: 2026-08-09 (v12.5) by Kimi Code CLI.

## Current Branch

**`Luna-Abner`** is the active development branch.
- Created: 2026-08-03
- Pushed to: `origin/Luna-Abner`
- All agent work should be committed and pushed to this branch, not `main`.
- ⚠️ **A working copy `~/Documentos/luna-kernel` NÃO tem `.git`** — a sessão v12.0 (2026-08-08) foi feita nela e precisa ser commitada/sincronizada com o repo git. Detalhes em `packages/kernel/.brain/bugs.md` seção v12.0.

## System State (2026-08-09)

| Component | Status | Notes |
|---|---|---|
| `luna-server` | Online (:3458) | Reiniciado após v12.4; HTTP 200. |
| `nexo-dashboard` | **Stopped** | Estava em crash-loop (↺7.069, `DATABASE_URL` ausente). Parado em 2026-08-08; entrada mantida no ecosystem (`pm2 start nexo-dashboard` para voltar). |
| `luna-health-watchdog` | **Removido** | Estava ONLINE apesar da decisão 2026-08-03 — parado, `pm2 delete`, removido do `pm2-ecosystem.config.js`, script em `_archive/`. Era o suspeito nº1 dos "restarts do nada" (reiniciava serviços → derrubava SSE/sessão do Chrome). |
| Chrome/CDP | Connected on `:9222` | Telemetria de crash em `logs/chrome-events.log` (v12.0). |
| SSE streaming | Working | v12.0: confirmationId no SSE, SSE antes do POST, dedup por messageId. |
| Extensão Chrome | **v2.7.0 — RELOAD PENDENTE** | `injected.js` mudou (dedup por bubble + miniJsonRepair). Recarregar em `chrome://extensions`. |
| Wallpaper | Deterministic | Constellation lines are seeded and visible after hard refresh. |

## v12.0 (2026-08-08) — robustez total do fluxo

Sessão Kimi Code corrigindo os 4 bugs relatados pelo dono + prompts + limpeza. **Detalhe completo: `packages/kernel/.brain/bugs.md` (seção v12.0), `decisions.md` (4 decisões datadas 2026-08-08), `changelog.md` (entrada SEM-HASH).**

1. Botão Confirmar sem ação → `confirmationId` agora vai no SSE (nunca ia).
2. Respostas brigando no input → escritor único (extensão observadora; `LUNA_EXT_DIRECT_EXEC=1` reverte) + zombie loop morto + echo guard.
3. Tools dormindo → dedup por bubble (extensão), TTL 10s (bridge), flush de accumulator órfão.
4. Mensagem atrasada → Phase 0 anti-stale, SSE antes do POST, dedup por messageId, fix do drain.
5. Nunca perder tool/response → `lib/tool-json-parser.cjs` (jsonrepair) unificado + `miniJsonRepair` na extensão + `[LUNA-RESCUE]`.
6. Prompts dois modos → toolLoop mínimo (config v1.4.0); telemetria `[LUNA-PROMPT] bytes=`.

**Validação manual pendente (dono):** reload da extensão + teste real cobrindo: confirmação destrutiva, loop 3+ tools, tool repetida com mesmos params, reload no meio do turno, resposta curta idêntica 2×.

## v12.2 (2026-08-08, mesmo dia) — Confirm/Cancel + anti-stale hard

**Detalhe: `packages/kernel/.brain/bugs.md` (seção v12.2), `changelog.md` (entrada SEM-HASH).**

1. Confirm/Cancel mortos → rota `/api/luna/confirm` retorna 410 (antes 200 com `ok:false` silencioso; mapa de confirmações é em memória e zera no restart do pm2); frontend mostra card expirado com mensagem clara.
2. Cancel = status `cancelled` neutro (não é erro — diretriz do dono), SVG lucide, sem emoji; Cancelar vermelho / Confirmar verde.
3. Response repetido em turno tool-only → anti-stale em 3 camadas no kimi-bridge; `initialText` nunca é entregue como resposta.

**Validação manual pendente (dono):** reload da extensão v2.7.0 (pendente desde v12.1) + teste real: confirmar/cancelar ação destrutiva, turno tool-only, F5 com confirmação pendente.

## v12.5 (2026-08-09) — Luna Premium Icon System (0 emojis)

**Detalhe: `packages/kernel/.brain/bugs.md` (seção v12.5), `changelog.md` (entrada SEM-HASH), `docs/superpowers/specs/2026-08-09-luna-premium-icon-system-design.md`.**

1. Icon system → `src/lib/icons/lunaIconMap.js` + `LunaIcon.svelte` criados; Lucide já estava instalado.
2. ToolCard/ChatArea/ChatInput/slashCommands → todos os emojis substituídos por Lucide.
3. ConfigDrawer/LunaMascot/LunaStage/LoginPage/modais → emojis removidos das strings.
4. ParticleBackground → lua desenhada via path (círculo + sombra), sem emoji `🌙`.
5. Bugfix extra → `tryParseToolJson` detecta `{"script"}` e mapeia para `executeScript`; `final-poll` processa candidates tool/script JSON como `action_detected` (fixa `ipython` e tools grandes ignoradas); `ToolCard` abre output por padrão; dedup TTL de action_detected 10s→2s.

**Validação manual pendente (dono):** abrir `http://localhost:3458`, enviar mensagem, confirmar que tools aparecem com ícones Lucide e que a lua no wallpaper não mudou de comportamento.

## v12.4 (2026-08-09) — thinking cortado (causa raiz real) + empty response falso

**Detalhe: `packages/kernel/.brain/bugs.md` (seção v12.4), `changelog.md` (entrada SEM-HASH).**

1. Thinking cortado → `_detectUiState` agora consulta `_hasActiveLoadingIndicators` (thinking containers, spinners, tool calls em execução, cursores) e força `isGenerating=true` quando o Stop some; `completion_candidate` só é aceito sem loading ativo.
2. "Empty response from provider" falso → `luna-soul.cjs` não emite erro fatal quando há confirmação destrutiva pendente; mantém o card ativo com mensagem `system`.
3. readFile sem output → `ToolCard.svelte` agora lê `result.result.content`; `_makeFriendlyFeedback('readFile')` inclui snippet do conteúdo na mensagem do card.
4. Tools ignoradas com `{"script"}` → `tryParseToolJson` no DOM structure agora detecta `script` e mapeia para `executeScript`; Kimi usando script em vez de tool não é mais ignorada.
5. v12.3 reclassificado → as defesas da v12.3 eram necessárias, mas a causa raiz do thinking cortado era a detecção de geração; resolvido na v12.4.

**Validação manual pendente (dono):** reload da extensão v2.7.0 + teste real: mensagem que force thinking longo (pergunta complexa ou "pensa passo a passo"), confirmar que o thinking não é cortado e a resposta corresponde ao turno atual.

## v12.3 (2026-08-09) — thinking cortado + response repetido

**Detalhe: `packages/kernel/.brain/bugs.md` (seção v12.3), `changelog.md` (entrada SEM-HASH).**

1. Response N repetindo N-1 → guarda stale do `responseCursor` ativada imediatamente; resposta igual ao turno anterior é descartada mesmo com thinking presente.
2. Thinking cortado → completion não dispara mais ao completar JSON wrapper; aguarda thinking e response estáveis por 3s.
3. System prompt vazando → filtro `isSystemPromptLeak` no `sanitizeStateChange` e no `response_delta`.
4. Final-extract aceitando eco → `parsedBeforeExtract` e candidatos do final-poll rejeitam resposta igual a `previousTurnFinalResponse`; defesa final antes do `done`.

**Validação manual pendente (dono):** reload da extensão v2.7.0 (elimina a causa raiz do eco) + teste real: 3 mensagens seguidas com thinking visível, confirmar que a 3ª não repete a 2ª.

## Pastas do projeto (2026-08-08)

- `~/Documentos/luna-kernel` — **ATIVA** (pm2 roda daqui; sem .git).
- `~/Documentos/luna-kernel-copia` — sandbox do dono (Luna edita aqui). Não tocar.
- `~/luna-kernel` — **terceira cópia descoberta em 2026-08-08**, papel desconhecido. Decisão do dono pendente (arquivar?).

## Recent Fixes (2026-08-03)

1. **Server stability** — Auto-Health Monitor removido de `luna-chat-routes.js` (loop de restart na porta 3458).
2. **Deterministic wallpaper** — `starAnimations.js` inicializa `currentX/currentY` no primeiro frame.
3. **Build + deploy** — `luna-web/dist/` rebuildado e servido na :3458.

## Known Quirks (Non-blocking)

- The thinking bubble may end with the text `JSON Copiar`. UI text leaked from Kimi's DOM extraction. Left as-is per owner request.
- `nexo-dashboard` parado (ver tabela). Se a :3456 for necessária, configurar `DATABASE_URL` antes de religar.

## Commands That Work Right Now

```bash
# Restart Luna cleanly
cd ~/Documentos/luna-kernel
pm2 restart luna-server

# Rebuild frontend
cd packages/kernel/luna-web
pnpm build
pm2 restart luna-server

# Rodar todos os testes do kernel
cd packages/kernel
for t in tests/*.test.cjs; do node "$t"; done
```

## Files to Check Before Changing Behavior

- `apps/dashboard/luna-chat-routes.js` — chat/SSE routes, health/auto-restart logic.
- `packages/kernel/luna-soul.cjs` — orchestrator, JSON parsing, thinking/response extraction.
- `packages/kernel/kimi-bridge.cjs` + `bridge-libs/` — CDP/Chrome control.
- `packages/kernel/lib/tool-json-parser.cjs` — parser tolerante unificado (v12.0).
- `packages/kernel/config/luna-prompt-config.json` — templates de prompt (v1.4.0).
- `packages/kernel/luna-web/src/components/ParticleBackground.svelte` — wallpaper.
- `packages/kernel/luna-web/src/lib/starAnimations.js` — star state/projection utilities.

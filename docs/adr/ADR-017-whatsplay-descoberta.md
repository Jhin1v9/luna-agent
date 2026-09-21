# ADR-017 — WhatsPlay: estado real da sessão e captura por mutação de DOM

- **Status:** aceito (2026-09-21, F1.4) · **CORRIGIDO em 2026-09-21 (falso negativo)**
- **Contexto:** §13 manda WhatsPlay = Chrome dedicado + Playwright + WhatsApp
  Web, captura por MUTAÇÃO de DOM (zero polling), watchdog com estados e
  fallback Telegram. O decreto da fase: descobrir o estado real da sessão em
  vez de inventar fluxo de QR.

## ⚠️ Correção — a conclusão original estava errada

A versão original deste ADR concluiu "sessão não pareada no perfil dedicado
(QR_PENDING)". **Falso.** O owner encontrou a evidência: a screenshot da
descoberta mostrava a lista de chats completa de uma conta real logada. Quem
falhou não foi a sessão — foi a **detecção de estado** (falso negativo grave:
reportar deslogado estando logado faria o watchdog gritar e o sistema desistir
de um transporte saudável).

**Causa raiz (3 fatores, confirmados com probe ao vivo contra a sessão real):**
1. `canvas` genérico como marcador de "QR visível" → falso positivo transitório;
2. espera fixa de 15s < duração da splash/intro em carga fria → avaliação num
   frame intermediário;
3. `[aria-label="Chat list"]` só casa em UI EN — o app do owner está em ES.

**Fix:** heurística pura e testável em `apps/whatsplay/src/state.ts` (marcadores
LOGGED são autoridade e vencem QR sempre; QR só com landing estrutural; polling
de 2s até 30s até estabilizar). Registrado no selector memory
(`.brain/luna/selectors/whatsapp.md`, append-only).

## O que a descoberta ao vivo encontrou (2026-09-21)

- Chrome dedicado sobe com `launchPersistentContext` + `executablePath` do
  Chrome do sistema + `user-data-dir` próprio (`~/.luna/chrome-whatsapp`) —
  **nunca o perfil do usuário**.
- **A sessão ESTAVA pareada** (conta real, lista de chats visível). O
  pareamento manual via `login` segue disponível para quando precisar, mas não
  era o bloqueio.
- Bug real achado na smoke: `page.evaluate` com função TS transformada pelo tsx
  quebra na página (`__name is not defined`). Fix: scripts de página como
  STRINGS (`page-scripts.ts`), e page.evaluate com string NÃO recebe argumento
  nem invoca função — IIFE com argumento embutido em JSON.
- Validação de leitura (headless, zero envio): badges de não-lidas ✅,
  abertura de chat ✅, extração de mensagens ✅ — seletores confirmados e
  registrados no selector memory.

## Decisões (mantidas da versão original)

1. `WhatsAppTransport` é a única fronteira — ZERO seletor fora de
   `apps/whatsplay` (§13). Implementação: `WhatsAppWebTransport` (Playwright).
2. Captura: MutationObserver in-page via `exposeBinding` — event-driven,
   zero polling.
3. Watchdog com os 5 estados do §13; na falha captura screenshot + DOM
   simplificado em `.brain/luna/incidents/`.
4. Fila de saída sem polling: handler grava resposta `send_state='queued'` +
   `pg_notify('luna_outbound')`; WhatsPlay escuta com `LISTEN`.
5. Telegram fallback (§15) via Bot API, token em env; desligado sem token.

## Consequências / F1.5

- Depende da confirmação do owner sobre qual conta está conectada (parece
  pessoal) para autorizar ENVIO de mensagens de teste.
- Auto-reparação visual (§14) consome as evidências do watchdog; precisão da
  classificação inbound/outbound e leitura de histórico virtualizado são v0.


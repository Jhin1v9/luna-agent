# ADR-017 — WhatsPlay: estado real da sessão e captura por mutação de DOM

- **Status:** aceito (2026-09-21, F1.4)
- **Contexto:** §13 manda WhatsPlay = Chrome dedicado + Playwright + WhatsApp
  Web, captura por MUTAÇÃO de DOM (zero polling), watchdog com estados e
  fallback Telegram. O decreto da fase: descobrir o estado real da sessão em
  vez de inventar fluxo de QR.

## O que a descoberta ao vivo encontrou (2026-09-21)

- Chrome dedicado sobe com `launchPersistentContext` + `executablePath` do
  Chrome do sistema + `user-data-dir` próprio (`~/.luna/chrome-whatsapp`) —
  **nunca o perfil do usuário**.
- WhatsApp Web carrega; estado detectado: **`QR_PENDING`** — o perfil dedicado
  **não tem sessão pareada**. A sessão logada existe no Chrome do usuário, mas
  usar o perfil dele com Playwright é inaceitável (lock de perfil, risco de
  dano, concorrência com o navegador do owner).
- Decisão: **pareamento único e manual** — `pnpm --filter whatsplay login`
  abre o Chrome dedicado headful por até 3min para o owner escanear o QR uma
  vez. O perfil dedicado guarda a sessão persistente depois disso. Isso NÃO é
  "inventar QR flow sem necessidade": a necessidade foi descoberta, não
  presumida.
- Bug real encontrado na smoke: `page.evaluate` com função TS transformada
  pelo tsx quebra na página (`__name is not defined`). Fix: scripts de página
  como STRINGS (`page-scripts.ts`), seletores seguem como argumento.

## Decisões

1. `WhatsAppTransport` (sendMessage/readConversation/getUnread/sendMedia?/
   getStatus) é a única fronteira — ZERO seletor fora de `apps/whatsplay`
   (§13). Implementação: `WhatsAppWebTransport` (Playwright).
2. Captura: MutationObserver in-page via `exposeBinding` — event-driven,
   zero polling. Extração de texto de não-lidas = v0 (a validar com sessão
   pareada; entradas vão pro selector memory).
3. Watchdog com os 5 estados do §13; na falha captura screenshot + DOM
   simplificado em `.brain/luna/incidents/` (base da auto-reparação F1.5).
4. Fila de saída sem polling: handler grava resposta `send_state='queued'` +
   `pg_notify('luna_outbound')`; WhatsPlay escuta com `LISTEN` e entrega.
5. Telegram fallback (§15) via Bot API, token em env; desligado sem token
   (falha explícita, nunca silencioso).

## Consequências / F1.5

- Depende do pareamento manual para o ciclo completo ao vivo (risco de ban
  ADR-004: delays humanos já no `sendMessage`, janela curta, sem spam).
- Selector memory: `.brain/luna/selectors/whatsapp.md` (append-only) —
  validar seletores v0 assim que a sessão parear e registrar entradas.
- Auto-reparação visual (§14) consome as evidências capturadas pelo watchdog.

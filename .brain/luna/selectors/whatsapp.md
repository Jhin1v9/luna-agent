# Memória de seletores — WhatsApp Web (§13)

> **Protocolo (obrigatório):** quando o WhatsApp Web mudar o DOM e uma captura
> quebrar, NUNCA editar entrada antiga — **append** no final com:
> `data · seletor antigo · seletor novo · fallback visual`. A Luna aprende os
> padrões de mudança do passado aqui. Firma: `data + autor: Luna`.

## Entradas

### 2026-09-21 · v0 inicial (não validado ao vivo) — autor: Luna
Primeira leva, extraída do conhecimento do DOM do WhatsApp Web. Estado real da
sessão descoberto pela primeira vez na F1.4 (ver `docs/adr/` e evidências em
`.brain/luna/incidents/`). Validar cada seletor em sessão logada e registrar
abaixo o resultado — sem edição desta entrada.

| Uso | Seletor v0 |
|---|---|
| Lista de conversas (sessão logada) | `[data-testid="chat-list"]`, `[aria-label="Chat list"]` |
| QR de pareamento visível | `[data-testid="qrcode"]`, `canvas` na intro |
| Item de conversa | `[data-testid="cell-frame-container"]`, `[role="row"]` |
| Badge de não-lidas | `[data-testid="icon-unread-count"]` |
| Painel de mensagens | `[data-testid="conversation-panel-wrapper"]`, `#main` |
| Mensagem (row) | `[data-testid="msg-container"]`, `.message-in/.message-out` |
| Texto da mensagem | `.selectable-text` |
| Campo de digitação | `[data-testid="conversation-compose-box-input"]`, `[contenteditable="true"]` |
| Botão enviar | `[data-testid="send"]`, `[aria-label="Send"]` |
| Título do chat | `[data-testid="conversation-info-header-chat-title"]` |

_Fallback visual (quando tudo falhar): screenshot + DOM simplificado capturados
por `WhatsAppWebTransport.captureEvidence()` — a auto-reparação visual (§14)
chega na F1.5._

### 2026-09-21 · fix falso negativo de estado (sessão logada reportada como QR_PENDING) — autor: Luna
**Aprendizado (§13 — a memória serviu para o que existe):** a heurística de
estado v0 falhou de três formas, descobertas com probe ao vivo contra a sessão
real logada (perfil dedicado, headless):
1. `canvas` solto como marcador de "QR visível" → falso positivo; a tela de QR
   de verdade usa landing estrutural. Removido o `canvas` genérico.
2. Espera fixa de 15s < tempo da splash/intro em carga fria → avaliação num
   frame transitório (data-ref presente, app não renderizado). Fix: polling a
   cada 2s até estabilizar (máx 30s) + heurística pura em `state.ts`.
3. `[aria-label="Chat list"]` só casa em UI EN; o PC do owner está em ES
   ("Lista de chats"). Autoridade agora é estrutural: `#pane-side`,
   `[data-testid="chat-list"]`, `[role="grid"]` — logado vence QR sempre.

**Seletores CONFIRMADOS ao vivo (sessão logada, 2026-09-21):**
- `[data-testid="chat-list"]` → presente (1) ✅
- `#pane-side` → presente (1) ✅
- `[data-testid="cell-frame-container"]` → 21 itens de conversa ✅
- `[data-testid="conversation-info-header-chat-title"]`, `msg-container`,
  `compose-box` → ausentes até abrir uma conversa (painel lazy) ⚠️
- badge de não-lidas (`[data-testid="icon-unread-count"]`) → a validar com `getUnread`

**Código:** `apps/whatsplay/src/state.ts` (heurística pura, 7 testes com
fixtures do DOM real) + `STATE_PROBES_SCRIPT` em `page-scripts.ts`.

### 2026-09-21 · validação de leitura ao vivo (painel, mensagens, direção) — autor: Luna
Validado com `pnpm --filter whatsplay readcheck` (headless, sessão real, só leitura):

**CONFIRMADOS (build atual do WA Web):**
- Abrir chat: clique NATIVO Playwright em `#pane-side [data-testid="cell-frame-container"]:has([title="NOME"])`
  ⚠️ `el.click()` sintético NÃO abre; e em seletor com vírgula `A, B:has(x)` o :has só vale pro último — prefixar ambos.
- Painel: `[data-testid="conversation-panel-wrapper"]`, `conversation-panel-messages`,
  `conversation-compose-box-input`, `conversation-info-header-chat-title`.
- Mensagem: `[data-testid="msg-container"]` ✅ (`.message-in/.message-out` NÃO EXISTEM mais nesta build).
- Texto: `.selectable-text` ✅.
- Direção (inbound/outbound): span `[aria-label="<remetente>:"]` — própria mensagem tem
  "Tú:"/"Você:"/"You:" (SELF = /^(tú|você|voce|you|tu)$/i, testado no nome antes dos dois pontos).
  ⚠️ v0: precisão ainda não 100% em chats com mídia; refinar na F1.5.
- Painel é LAZY/VIRTUALIZADO: poucos msg-container no DOM de uma vez; scroll carrega mais
  (relevante pra leitura de histórico longo — F1.5).

**VIEW "Archivados":** pode vir aberta (sessão restaura UI). Sair: detectar heading de texto
exato (normalizar marcas invisíveis \u202A-\u202E) e clicar `#side > div:first-child [role="button"]`;
fallback reload. A entrada da pasta no menu principal também tem o texto — distinguir pelo
parent `cell-frame-title`.

**ESTADO (heurística final):** `apps/whatsplay/src/state.ts` — LOGGED vence QR sempre;
QR só com landing estrutural (nunca canvas solto); LOADING = splash; polling 2s até 30s.

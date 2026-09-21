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

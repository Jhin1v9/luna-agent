/**
 * Seletores do WhatsApp Web — ÚNICO lugar do sistema onde CSS/DOM mora (§13).
 * O orchestrator só conhece a interface WhatsAppTransport; se daqui a 2 anos
 * o transporte mudar, troca-se este arquivo + o adapter e o cérebro nem percebe.
 *
 * Mudanças de seletor SEMPRE registradas em .brain/luna/selectors/whatsapp.md
 * (append-only: data, seletor antigo, seletor novo, fallback visual — §13).
 *
 * v0 = valores iniciais NÃO validados ao vivo; a descoberta F1.4 confirma.
 */

export const SELECTORS = {
  /** Indica sessão logada: a lista de conversas visível. Se ausente + QR visível → deslogado. */
  chatList: '[data-testid="chat-list"], [aria-label="Chat list"]',
  /** QR code de pareamento visível na tela de intro. */
  qrCanvas: '[data-testid="qrcode"], [data-ref="intro-md-beta-logo-dark"], canvas',
  /** Item de conversa na lista (tem badge de não-lidas quando há novas mensagens). */
  chatItem: '[data-testid="cell-frame-container"], [role="row"]',
  /** Badge de mensagens não lidas dentro do item de conversa. */
  unreadBadge: '[data-testid="icon-unread-count"], span[aria-label*="unread"]',
  /** Painel de mensagens aberto (conversa selecionada). */
  messagePanel: '[data-testid="conversation-panel-wrapper"], #main',
  /** Mensagens no painel. */
  messageRow: '[data-testid="msg-container"], div.message-in, div.message-out',
  /** Texto dentro de uma mensagem. */
  messageText: '.selectable-text, span[dir="ltr"]',
  /** Campo de digitação. */
  inputBox: '[data-testid="conversation-compose-box-input"], div[contenteditable="true"][data-tab="10"]',
  /** Botão enviar. */
  sendButton: '[data-testid="send"], button[aria-label="Send"]',
  /** Título do chat aberto (nome do contato/grupo). */
  chatTitle: '[data-testid="conversation-info-header-chat-title"], header span[title]',
  /** Marcador de grupo (header de grupo tem "Você" / participants info). */
  groupHeader: '[data-testid="conversation-info-header"]',
} as const;

export type SelectorKey = keyof typeof SELECTORS;

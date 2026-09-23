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
  /** QR code de pareamento — NUNCA usar `canvas` solto (falso positivo em tela logada, F1.4). */
  qrCanvas: '[data-testid="qrcode"], [data-ref="intro-md-beta-logo-dark"]',
  /** Item de conversa na lista (tem badge de não-lidas quando há novas mensagens). */
  chatItem: '[data-testid="cell-frame-container"], [role="row"]',
  /** Badge de mensagens não lidas dentro do item de conversa. */
  unreadBadge: '[data-testid="icon-unread-count"], span[aria-label*="unread"]',
  /** Painel de mensagens aberto (conversa selecionada). */
  messagePanel: '[data-testid="conversation-panel-wrapper"], #main',
  /** Mensagens no painel. */
  messageRow: '[data-testid="msg-container"]',
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
  /** 🆕 LUPA (PLANO-SKILLS): botão de busca DENTRO do chat (cabeçalho #main).
   *  WA Web muda o aria-label por idioma (Search/Pesquisar/Buscar) — casamos
   *  os três, case-insensitive, restrito ao header da conversa aberta. */
  inChatSearchButton:
    '#main header button[aria-label*="Search" i], #main header button[aria-label*="Pesquisar" i], #main header button[aria-label*="Buscar" i]',
  /** 🆕 LUPA: campo de busca que abre no topo do painel da conversa. */
  inChatSearchInput:
    '#main [data-testid="search-input"] input, #main [data-testid="search-input"], #main input[placeholder*="Search" i], #main input[placeholder*="Pesquisar" i], #main input[placeholder*="Buscar" i]',
  /** 🆕 LUPA: marcações de texto que casaram com a busca (resultados). */
  searchHighlight: '.matched-text, span[class*="highlight" i], [data-testid="search-message-highlight"]',
  /** 🆕 CITAÇÃO (mention.respond v2): botão de contexto que aparece no hover da mensagem.
   *  Ao vivo 2026-09-23 (WA 2026, wds-design-system): o testid REAL é
   *  icon-down-context (div[role=button], aria "Menú contextual del mensaje").
   *  Os testids antigos (msg-options etc.) foram removidos nesta versão. */
  msgContextButton:
    '[data-testid="icon-down-context"], [data-testid="msg-options"], [data-testid="chevron-down"], span[data-testid="down-context"], [data-testid="message-context-button"]',
  /** 🆕 CITAÇÃO: item "Responder" do menu de contexto (texto casa i18n no código). */
  contextMenu: '[data-testid="msg-context-menu"], div[role="menu"], [data-testid="dropdown"]',
  /** 🆕 CITAÇÃO: preview da mensagem citada preso ao campo de composição.
   *  Ao vivo 2026-09-23: o testid é quoted-message e ele fica DENTRO do footer
   *  (ao lado do compose-box). Scoping em footer evita falso positivo com
   *  citações históricas do painel, que usam o mesmo testid. */
  replyPreview:
    'footer [data-testid="quoted-message"], footer [data-testid="quoted-preview"], footer [data-testid="reply-preview"], footer [data-testid*="quoted" i], footer .reply-preview',
} as const;

export type SelectorKey = keyof typeof SELECTORS;

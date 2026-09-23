/**
 * WhatsAppTransport — o contrato isolado do §13. ZERO seletor CSS aqui.
 * O orchestrator (e qualquer outro consumidor) programa contra esta interface:
 * se amanhã existir um transporte melhor, troca-se a implementação e o
 * cérebro não se entera.
 */

export type SessionState = 'LOGGED_IN' | 'QR_PENDING' | 'LOADING' | 'UNKNOWN';

export interface TransportStatus {
  state: SessionState;
  pageAlive: boolean;
  lastHeartbeatAt: string;
  /** Mensagens na fila de saída aguardando envio. */
  outgoingQueued: number;
  details?: string;
}

export interface UnreadMessage {
  /** Identidade do chat (jid ou melhor identificador estável disponível). */
  chat_id: string;
  chat_name: string;
  is_group: boolean;
  text: string;
  /** Id estável da mensagem no canal (idempotência — §7.6). */
  external_id: string;
  /** Texto da mensagem citada, se a nova msg for reply. */
  quoted_text?: string | null;
  quoted_from_luna?: boolean;
  /** @luna mencionado no texto. */
  mentioned_luna: boolean;
  /** Quem falou (nome do membro no grupo / contato no privado). */
  author_name?: string | null;
  received_at: string;
}

export interface ConversationMessage {
  sender: string;
  direction: 'inbound' | 'outbound';
  text: string;
  /** Quem falou (nome do membro no grupo; 'Tú'/null no outbound). */
  author?: string | null;
  /** data-id estável da mensagem no WA (discriminador do external_id §7.6). */
  mid?: string;
}

export interface WhatsAppTransport {
  /** Estado da sessão WhatsApp Web. */
  getStatus(): Promise<TransportStatus>;
  /** Chats com mensagens não lidas (após debounce quem consome decide). */
  getUnread(): Promise<UnreadMessage[]>;
  /** Histórico recente de uma conversa (Context Builder, §7.9). */
  readConversation(chatId: string, limit?: number): Promise<ConversationMessage[]>;
  /** Envia texto. Retorna o external_id da mensagem enviada. */
  sendMessage(chatId: string, text: string, opts?: { inputSelector?: string }): Promise<string>;
  /** Mídia fica para F1.5 (áudio/print); a interface já reserva o lugar. */
  sendMedia?(chatId: string, mediaPath: string, caption?: string): Promise<string>;
  /** Chat aberto no momento é grupo? (best-effort, v0 — sweep de teste). */
  currentChatIsGroup?(): Promise<boolean>;
  /** 🆕 LUPA (PLANO-SKILLS): busca dentro do chat aberto. Abre o chat, clica a
   *  lupa do cabeçalho, digita a query e conta as marcações de resultado.
   *  Não envia nada — só localiza. */
  searchInChat?(chatId: string, query: string): Promise<ChatSearchResult>;
  /** 🆕 CITAÇÃO (mention.respond v2, PLANO-SKILLS): localiza a mensagem que
   *  casa com messageQuery (painel ou lupa), anexa citação visual (Reply) e
   *  envia text respondendo ELA. Falha explícita se a citação não anexar. */
  replyToMessage?(chatId: string, messageQuery: string, text: string): Promise<string>;
  /** 🆕 PONTE KIMI WORK: detecta chamada recebida (popup Aceptar/Rechazar). */
  detectIncomingCall?(): Promise<{ caller: string } | null>;
  /** 🆕 PONTE KIMI WORK: atende a chamada recebida. */
  acceptCall?(): Promise<void>;
  /** 🆕 PONTE KIMI WORK: recusa a chamada recebida. */
  declineCall?(): Promise<void>;
}

/** 🆕 Resultado da lupa (busca dentro do chat). */
export interface ChatSearchResult {
  /** Achou pelo menos uma mensagem com a query. */
  found: boolean;
  /** Quantas marcações de resultado o painel mostrou (0 = nada achado). */
  resultCount: number;
}

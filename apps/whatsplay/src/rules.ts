/**
 * Regras de resposta por chat (§5 — comportamento em grupos).
 * Uma regra, zero classificadores: privado sempre responde; grupo só se
 * mencionam @luna ou fazem reply/cita em mensagem da Luna. Todo o resto em
 * grupo: silêncio absoluto, zero tokens.
 */

export interface InboundChatFacts {
  is_group: boolean;
  text: string;
  mentioned_luna: boolean;
  reply_to_luna: boolean;
}

const MENTION_RE = /@luna\b/i;

export function extractMention(text: string): boolean {
  return MENTION_RE.test(text);
}

export function shouldRespond(chat: InboundChatFacts): boolean {
  if (!chat.is_group) return true; // privado = sempre responde (regra fixa)
  return chat.mentioned_luna || chat.reply_to_luna; // grupo: @luna ou reply
}

/**
 * Regras de resposta por chat (§5 — comportamento em grupos), decreto do
 * owner (2026-09-21): no grupo, Luna responde quando a mensagem contiver o
 * TEXTO "@luna" (case-insensitive) — mesmo sem menção estruturada real
 * (sem contato salvo, sem reply/cita). Reply/cita continua valendo. Silêncio
 * absoluto no resto.
 *
 * Decisão registrada (decree + simplicidade): "@ luna" (com espaço) e
 * "luna:" NÃO entram — só a substring exata "@luna". Substring por decreto:
 * "oluna" não dispara (sem '@'); "@lunatico" dispararia (decreto aceito,
 * mantém simples — zero classificadores).
 */

export interface InboundChatFacts {
  is_group: boolean;
  text: string;
  mentioned_luna: boolean;
  reply_to_luna: boolean;
}

/** Texto contém "@luna" (case-insensitive, substring exata). */
export function extractMention(text: string): boolean {
  return text.toLowerCase().includes('@luna');
}

export function shouldRespond(chat: InboundChatFacts): boolean {
  if (!chat.is_group) return true; // privado = sempre responde (regra fixa)
  return chat.mentioned_luna || chat.reply_to_luna; // grupo: "@luna" no texto ou reply
}

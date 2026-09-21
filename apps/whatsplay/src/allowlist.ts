/**
 * Allowlist matching compartilhado entre outbound (entrega) e ingest
 * (processamento). Decretos do owner (ADR-020): match estrito, fail-closed.
 *
 * - entrada SEM '@' → match exato pelo NOME do contato/chat, com
 *   NORMALIZAÇÃO de invisíveis (marcas bidi \u202A-\u202E, \u200E/\u200F) dos
 *   dois lados — títulos do WhatsApp às vezes carregam essas marcas e o
 *   match exato quebraria silenciosamente (decisão F1.5+, namorada do owner:
 *   "Meu Amorzinho 💖🌻" entrou no escopo com emoji, sem jid estável).
 * - entrada COM '@' → match por sufixo de jid (5511...@g.us), sem
 *   normalização (jid é ASCII).
 * - substring solto NÃO vale ("Pai" não libera "Papai") — falso-positivo de
 *   allow é o pior cenário destes guardrails.
 */

export function parseAllowlist(raw: string | undefined | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Remove marcas invisíveis de direção de texto que o WhatsApp insere nos títulos. */
export function normalizeName(s: string): string {
  return s.replace(/[‪-‮‎‏]/g, '').trim();
}

export function matchesAllowlist(entries: string[], target: string): boolean {
  return entries.some((entry) =>
    entry.includes('@') ? target.endsWith(entry) : normalizeName(entry) === normalizeName(target),
  );
}

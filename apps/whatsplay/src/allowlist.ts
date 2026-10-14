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

/** Dígitos de identidade numérica: local do jid ("5511...@g.us"), número
 *  puro ("34685093192"), telefone formatado ("+34 685 09 31 92") ou com
 *  prefixo "whatsapp:". Nomes retornam null (seguem pelo match de nome). */
function jidDigits(s: string): string | null {
  const bare = normalizeName(s).replace(/^whatsapp:/i, '');
  if (bare.includes('@')) {
    const local = bare.slice(0, bare.indexOf('@'));
    const d = local.replace(/\D/g, '');
    return d.length >= 6 ? d : null;
  }
  if (/^[+\d][\d\s().-]*$/.test(bare)) {
    const d = bare.replace(/\D/g, '');
    return d.length >= 6 ? d : null;
  }
  return null;
}

export function matchesAllowlist(entries: string[], target: string): boolean {
  // 2026-10-14 (bug ao vivo): alvo "120363428577835024" (dígitos puros do
  // chat_id) recusado contra entrada "120363428577835024@g.us" — endsWith
  // nunca casava. Quando AMBOS têm identidade numérica, compara os dígitos.
  const tDigits = jidDigits(target);
  return entries.some((entry) => {
    const eDigits = jidDigits(entry);
    if (eDigits && tDigits) return eDigits === tDigits;
    return entry.includes('@') ? target.endsWith(entry) : normalizeName(entry) === normalizeName(target);
  });
}

/**
 * Allowlist matching compartilhado entre outbound (entrega) e ingest
 * (processamento). Decretos do owner (ADR-020): match estrito, fail-closed.
 *
 * - entrada SEM '@' → match exato pelo nome do contato/chat;
 * - entrada COM '@' → match por sufixo de jid (5511...@g.us);
 * - substring solto NÃO vale ("Pai" não libera "Papai") — falso-positivo de
 *   allow é o pior cenário destes guardrails.
 */

export function parseAllowlist(raw: string | undefined | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function matchesAllowlist(entries: string[], target: string): boolean {
  return entries.some((entry) => (entry.includes('@') ? target.endsWith(entry) : entry === target));
}

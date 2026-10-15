/**
 * Compatibilidade temporária com a antiga resolução de aliases.
 *
 * Uma pessoa, um registro canônico, muitos apelidos. O cérebro fala "pai",
 * "noke", "superclim" — o sistema resolve pro contato certo, sempre. Sem
 * isso, cada LLM inventa uma grafia e o resolver erra.
 *
 * Fonte da verdade do NÚMERO continua sendo a tabela `contacts`
 * (contact-map.ts, metadata->>'phone') — este módulo normaliza NOME/APelido
 * → canônico e marca o papel (role: 'dono'). Os dois se combinam: skills.ts
 * normaliza o nome ANTES de chamar o resolver.
 *
 * A instância Superclim não mantém pessoas ou números hardcoded. A fonte de
 * verdade é `chat_registry`, no PostgreSQL isolado. Aliases novos também devem
 * ser cadastrados como dados, nunca adicionados ao código.
 */

export interface DonoEntry {
  /** Nome canônico (como deve aparecer em relatórios/auditoria). */
  canonical: string;
  /** Número E.164 (+34 …), com fallback do WhatsApp da Luna. */
  phone: string;
  /** Chat 1:1 no WhatsApp da Luna abre com este título (placeVoiceCall/openChat). */
  chatTitle: string;
  /** Todas as grafias que o cérebro/owner pode usar — minúsculas, sem acento. */
  aliases: string[];
  role: 'dono';
}

export const DONOS: readonly DonoEntry[] = [];

/** Normaliza grafia: minúsculas, trim, colapsa espaços. */
export function normalizeSpelling(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Resolve qualquer grafia (alias) → entrada canônica do dono. null se não for dono. */
export function resolveDono(name: string): DonoEntry | null {
  const n = normalizeSpelling(name);
  for (const d of DONOS) {
    if (d.aliases.includes(n) || normalizeSpelling(d.canonical) === n || normalizeSpelling(d.chatTitle) === n) return d;
  }
  return null;
}

/** Só confirma se é dono (para guardrails: ação sensível exige autorizador dono). */
export function isDono(name: string): boolean {
  return resolveDono(name) !== null;
}

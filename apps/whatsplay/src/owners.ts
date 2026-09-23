/**
 * DONOS — registro canônico dos sócios da Nexo (decreto owner 2026-09-23).
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
 * ⚠️ Nunca inventar contato: quem entra aqui é porque o OWNER falou
 * explicitamente ("já guarda eles. somos os DONOS da nexo ok").
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

export const DONOS: readonly DonoEntry[] = [
  {
    canonical: 'Abner Mendes',
    phone: '+34 685 09 31 92',
    chatTitle: 'Abner',
    aliases: ['abner', 'abner mendes', 'eu', 'meu numero', 'meu número'],
    role: 'dono',
  },
  {
    canonical: 'Elias Israel Mendes',
    phone: '+34 672 95 30 62',
    chatTitle: 'Superclim Servicios',
    aliases: ['pai', 'elias', 'elias israel mendes', 'superclim', 'superclim servicios', 'superclim serviços'],
    role: 'dono',
  },
  {
    canonical: 'Enoque Santos',
    phone: '+34 689 13 51 59',
    chatTitle: 'Nonoke',
    aliases: ['noke', 'nonoke', 'enoque', 'enoque santos'],
    role: 'dono',
  },
] as const;

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

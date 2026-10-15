import type { Sql } from './audit.js';

/**
 * Chat Registry (migração 012) — identidade própria por chat, fix definitivo
 * do incidente P0 de 2026-09-23 (chamada foi parar em contato fora do escopo
 * porque o alvo era nome solto e a resolução no WA era cega).
 *
 * Política (deny-first, fail-closed):
 *  - role 'blocked' → NUNCA (recusa, com o motivo).
 *  - fora do registry → recusa + pede registro ao owner (nunca resolve no escuro).
 *  - role 'allowed' → passa, e devolve a identidade (chat_key) pra resolução
 *    por NÚMERO no WA — nunca por nome da lista.
 *
 * display_hint (nome do WA) é apenas dica de busca; a identidade é chat_key.
 */

export interface RegistryEntry {
  chatKey: string;
  kind: 'individual' | 'group';
  canonicalName: string;
  displayHint: string | null;
  role: 'owner' | 'allowed' | 'blocked';
  notifyChannel: string | null;
  phoneE164: string | null;
}

export type RegistryDecision =
  | { ok: true; entry: RegistryEntry }
  | { ok: false; reason: string };

/** Normaliza uma menção do owner ('meu pai', 'Pai', 'produção') pra lookup.
 *  Remove acentos E emojis/símbolos — bug ao vivo 15/10: badge do grupo
 *  'Proyecto Nexo - OnaDance 👯 - 26' não casava com o registry
 *  '…👩🏼‍🐰‍👩🏽- 26' (mesmo grupo, emoji renderizado diferente) e o grupo
 *  allowed virou solicitação de contato fantasma pro owner. */
function normalize(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function registryLookup(db: Sql, mention: string): Promise<RegistryEntry | null> {
  const rows = await db.query(
    `SELECT chat_key, kind, canonical_name, display_hint, role, notify_channel, phone_e164
       FROM chat_registry`,
    [],
  );
  const target = normalize(mention).replace(/^meu |^minha |^o |^a /, '');
  if (!target) return null; // menção sem conteúdo textual (só emoji/símbolo) — nunca casa
  const targetDigits = mention.replace(/\D/g, '');
  for (const r of rows.rows as Array<Record<string, unknown>>) {
    const canon = normalize(String(r.canonical_name));
    const hint = r.display_hint ? normalize(String(r.display_hint)) : null;
    const keyDigits = String(r.chat_key).replace(/\D/g, '');
    if (
      canon === target ||
      hint === target ||
      canon.includes(target) ||
      (hint && hint.includes(target)) ||
      (targetDigits.length >= 8 && keyDigits === targetDigits)
    ) {
      return {
        chatKey: String(r.chat_key),
        kind: r.kind as RegistryEntry['kind'],
        canonicalName: String(r.canonical_name),
        displayHint: (r.display_hint as string | null) ?? null,
        role: r.role as RegistryEntry['role'],
        notifyChannel: (r.notify_channel as string | null) ?? null,
        phoneE164: (r.phone_e164 as string | null) ?? null,
      };
    }
  }
  return null;
}

/** Política deny-first. `acao` entra na mensagem de recusa (ligar/mensagem). */
export async function registryCheck(db: Sql, mention: string, acao: string): Promise<RegistryDecision> {
  const entry = await registryLookup(db, mention);
  if (!entry) {
    return {
      ok: false,
      reason: `'${mention}' NÃO está no cadastro (chat_registry) — não vou ${acao} sem identidade verificada. Registre nome + número primeiro.`,
    };
  }
  if (entry.role === 'blocked') {
    return { ok: false, reason: `'${entry.canonicalName}' está BLOCKED no Chat Registry — ${acao} recusado(a), sempre.` };
  }
  return { ok: true, entry };
}

/** Registra (ou atualiza) um chat. Usado pelo fluxo de resolução assistida. */
export async function registryUpsert(
  db: Sql,
  e: Omit<RegistryEntry, 'displayHint'> & { displayHint?: string | null; note?: string; resolvedBy?: string },
): Promise<void> {
  await db.query(
    `INSERT INTO chat_registry (chat_key, kind, canonical_name, display_hint, role, notify_channel, phone_e164, resolved_by, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (chat_key, kind) DO UPDATE SET
       canonical_name = EXCLUDED.canonical_name,
       display_hint   = EXCLUDED.display_hint,
       role           = EXCLUDED.role,
       notify_channel = EXCLUDED.notify_channel,
       phone_e164     = EXCLUDED.phone_e164,
       resolved_by    = EXCLUDED.resolved_by,
       note           = EXCLUDED.note`,
    [
      e.chatKey,
      e.kind,
      e.canonicalName,
      e.displayHint ?? null,
      e.role,
      e.notifyChannel ?? null,
      e.phoneE164 ?? null,
      e.resolvedBy ?? 'agent',
      e.note ?? null,
    ],
  );
}

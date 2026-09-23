import type { Pool } from 'pg';
import type { ContactRef } from './skills.js';

/**
 * ContactMap (PLANO-SKILLS.md §2 "Contatos") — mapeamento 1x de contatos.
 *
 * Fonte da verdade: tabela `contacts`, coluna `metadata` (jsonb):
 *   metadata->>'phone' → número/jid mapeado (busca determinística)
 *   metadata->>'role'  → papel interno (cliente, parceiro, família…)
 *
 * Mapear uma vez, reusar pra sempre: o cérebro chama a skill com o NOME e o
 * resolver devolve o número. Sem mapeamento, cai na busca por nome (hoje).
 *
 * Preenchimento: script de mapeamento (abre o chat e lê o cabeçalho/info do
 * contato — exige o Chrome dedicado parado) OU confirmação manual do owner.
 * Ver docs/PLANO-SKILLS.md fase 2.
 */

export function createContactMapResolver(pool: Pool) {
  return async function resolveContact(name: string): Promise<ContactRef | null> {
    const r = await pool.query<{ name: string; phone: string | null }>(
      `SELECT name, metadata->>'phone' AS phone
       FROM contacts WHERE name = $1
       ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
      [name],
    );
    if (!r.rowCount) return null;
    return { name: r.rows[0]!.name, phone: r.rows[0]!.phone };
  };
}

/** Grava o número mapeado de um contato (idempotente — só grava se diferente). */
export async function mapContactPhone(pool: Pool, name: string, phone: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE contacts SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{phone}', $2::jsonb),
            updated_at = now()
     WHERE name = $1 AND metadata->>'phone' IS DISTINCT FROM $2`,
    [name, JSON.stringify(phone)],
  );
  return (r.rowCount ?? 0) > 0;
}

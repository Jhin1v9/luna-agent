import { loadDotEnv, loadConfig } from '@luna/shared';
import { getPool, ensureOrganization, ensureClient } from '@luna/database';
import { closePool } from '@luna/database';

/**
 * Seed dev (idempotente): clientes/projetos de exemplo mapeados às conversas
 * reais do escopo. Roda: pnpm exec tsx scripts/seed-dev.ts
 * - Jess (onadance) + projeto "Site Onadance" (link cliente↔projeto via FK).
 * - Grupo interno Production - 2026 como "cliente" interno (contexto do time).
 */

loadDotEnv();
const config = loadConfig();
const pool = getPool(config.DATABASE_URL);

async function ensureProject(clientId: string, name: string): Promise<void> {
  const existing = await pool.query('SELECT id FROM projects WHERE client_id = $1 AND name = $2', [clientId, name]);
  if (existing.rowCount) return;
  await pool.query('INSERT INTO projects (client_id, name) VALUES ($1, $2)', [clientId, name]);
}

async function main(): Promise<void> {
  const orgId = await ensureOrganization(pool);

  const jess = await ensureClient(pool, orgId, 'Jess (Onadance)');
  await ensureProject(jess, 'Site Onadance');
  await pool.query(
    `UPDATE clients SET profile = profile || $2::jsonb WHERE id = $1`,
    [jess, JSON.stringify({ known_as: 'Jess', segmento: 'dança/estúdio', fonte: 'grupo Production - 2026' })],
  );

  const internal = await ensureClient(pool, orgId, 'NEXO Internal');
  await ensureProject(internal, 'Produção 2026');
  await pool.query(
    `UPDATE clients SET profile = profile || $2::jsonb WHERE id = $1`,
    [internal, JSON.stringify({ tipo: 'grupo_interno', observacao: '🏆Production - 2026🙏🏻 é time, não cliente' })],
  );

  console.log('seed ok: Jess (onadance) + Site Onadance · NEXO Internal + Produção 2026');
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

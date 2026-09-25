/**
 * sync-clients-registry — o número de telefone que o CLIENTE coloca no perfil
 * do workspace (Dados Pessoais → Telefone) vira a identidade de roteamento das
 * notificações da Luna (decreto owner 2026-09-25):
 *
 *   perfil do cliente (workspace) ──sync──▶ chat_registry.notify_channel
 *        = whatsapp:+<telefone>                     ▼
 *                          notifications engine entrega lá
 *
 * Roda na varredura/cron ou manual:
 *   DATABASE_URL=... pnpm exec tsx scripts/sync-clients-registry.ts
 *
 * Só registra quem TEM telefone preenchido. Nunca remove entradas existentes
 * (blocklist e registros manuais são sagrados). Idempotente (upsert por dígitos).
 */
import pg from 'pg';

async function fetchAdminClients(): Promise<Array<{
  email: string | null;
  name: string | null;
  phone: string | null;
  organization: { name: string | null; slug: string | null } | null;
}>> {
  const { getJson } = await import('./lib/nexo-client.mjs');
  const { status, body } = await getJson('/nexo/api/admin/clients');
  if (status !== 200) throw new Error(`GET admin/clients → ${status}: ${JSON.stringify(body).slice(0, 200)}`);
  return ((body as { data?: unknown }).data ?? []) as never;
}

const digits = (p: string): string => p.replace(/\D/g, '');

async function main(): Promise<void> {
  const users = await fetchAdminClients();
  const comFone = users.filter((u) => u.phone && digits(u.phone).length >= 8);
  console.log(`${users.length} usuários no workspace · ${comFone.length} com telefone preenchido`);

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    let upsertados = 0;
    for (const u of comFone) {
      const d = digits(u.phone!);
      const e164 = u.phone!.trim().startsWith('+') ? u.phone!.trim() : `+${d}`;
      const canonical = u.name?.trim() || u.email || d;
      const orgName = u.organization?.name ?? null;
      await pool.query(
        `INSERT INTO chat_registry (chat_key, kind, canonical_name, display_hint, role, notify_channel, phone_e164, resolved_by, note)
         VALUES ($1, 'individual', $2, $3, 'allowed', $4, $5, 'workspace-sync',
                 $6)
         ON CONFLICT (chat_key, kind) DO UPDATE SET
           notify_channel = EXCLUDED.notify_channel,
           phone_e164     = EXCLUDED.phone_e164,
           note           = EXCLUDED.note,
           resolved_by    = 'workspace-sync'
         WHERE chat_registry.role <> 'blocked'`,
        [d, canonical, orgName, `whatsapp:${e164}`, e164, `email:${u.email ?? 'n/d'} · org:${orgName ?? 'n/d'}`],
      );
      upsertados++;
      console.log(`  ✅ ${canonical}${orgName ? ` (${orgName})` : ''} → whatsapp:${e164}`);
    }
    console.log(`\n${upsertados} registro(s) sincronizados (blocklist nunca tocada).`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(String(e).slice(0, 300));
  process.exit(1);
});

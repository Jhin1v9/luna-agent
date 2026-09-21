import type { Sql } from './audit.js';

/**
 * ADMIN_FULL (§7.9) — visão do time: saúde, fila, incidentes, escalções,
 * custo do dia. Mora no @luna/database porque worker (chat admin §25) e
 * orchestrator (Context Builder) consomem — sem import cruzado de app.
 */

export interface AdminPack {
  name: string;
  sections: string[];
}

export async function buildAdminFullPack(pool: Sql): Promise<AdminPack> {
  const sections: string[] = ['Visão ADMIN_FULL do sistema:'];
  const hb = await pool
    .query(`SELECT service, meta->>'state' AS state, round(extract(epoch from now()-seen_at)) AS idade
            FROM service_heartbeats ORDER BY service`)
    .catch(() => ({ rows: [] as Array<{ service: string; state: string | null; idade: number }> }));
  sections.push(
    `Serviços (heartbeat):\n${hb.rows.map((r) => `- ${r.service}: ${r.state ?? 'ok'} (${r.idade}s atrás)`).join('\n') || '- sem heartbeats'}`,
  );
  const incidents = await pool.query(
    `SELECT severity, title FROM incidents WHERE status = 'open' ORDER BY created_at DESC LIMIT 5`,
  );
  sections.push(
    incidents.rowCount
      ? `Incidentes abertos:\n${incidents.rows.map((i) => `- [${i.severity}] ${i.title}`).join('\n')}`
      : 'Incidentes abertos: nenhum. ✅',
  );
  const escalations = await pool.query(
    `SELECT priority, reason FROM escalations WHERE status = 'open' ORDER BY created_at DESC LIMIT 5`,
  );
  sections.push(
    escalations.rowCount
      ? `Escalções ativas (§8 coordenação):\n${escalations.rows.map((e) => `- [${e.priority}] ${e.reason}`).join('\n')}`
      : 'Escalções ativas: nenhuma. ✅',
  );
  const queue = await pool.query(
    `SELECT (SELECT count(*) FROM jobs WHERE status='pending') AS jobs,
            (SELECT count(*) FROM messages WHERE send_state='queued') AS outbound,
            (SELECT count(*) FROM outbox WHERE status='pending') AS outbox`,
  );
  sections.push(
    `Filas: jobs=${queue.rows[0]!.jobs} · outbound=${queue.rows[0]!.outbound} · outbox=${queue.rows[0]!.outbox}`,
  );
  const usage = await pool.query(
    `SELECT coalesce(round(sum(estimated_cost)::numeric, 4), 0) AS custo_hoje, count(*) AS chamadas
     FROM usage_entries WHERE created_at::date = now()::date`,
  );
  sections.push(
    `Custo Kimi hoje: $${usage.rows[0]!.custo_hoje} em ${usage.rows[0]!.chamadas} chamada(s) (usage ledger §23).`,
  );
  const activity = await pool.query(`SELECT summary FROM activity_log ORDER BY id DESC LIMIT 8`);
  if (activity.rowCount) {
    sections.push(`Últimas atividades (§20):\n${activity.rows.map((a) => `- ${a.summary}`).join('\n')}`);
  }
  return { name: 'ADMIN_FULL', sections };
}

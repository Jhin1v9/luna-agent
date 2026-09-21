import type { Pool } from 'pg';

/**
 * Heartbeats de serviços (§20 — watchdog geral): cada daemon sobe sua linha
 * em service_heartbeats; o watchdog geral lê e decide restart/alerta.
 */

export async function writeHeartbeat(
  pool: Pool,
  service: string,
  pid: number,
  meta: Record<string, unknown> = {},
): Promise<void> {
  await pool.query(
    `INSERT INTO service_heartbeats (service, pid, meta, seen_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (service) DO UPDATE
       SET pid = EXCLUDED.pid, meta = EXCLUDED.meta, seen_at = EXCLUDED.seen_at`,
    [service, pid, meta],
  );
}

export interface HeartbeatRow {
  service: string;
  pid: number | null;
  meta: Record<string, unknown>;
  seen_at: string;
}

export async function readHeartbeats(pool: Pool): Promise<HeartbeatRow[]> {
  const res = await pool.query<HeartbeatRow>('SELECT * FROM service_heartbeats ORDER BY service');
  return res.rows;
}

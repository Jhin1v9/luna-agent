import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createInvestigateHandler } from './investigate.js';
import type { JobRow } from './poller.js';

/**
 * Investigação HANDOFF_LIVE (P2 — fecha ADR-023). Pool e live brain
 * INJETADOS: sem Postgres real e sem CLI real na suíte.
 */

const log = pino({ level: 'silent' });

interface Captured {
  inserts: Array<{ sql: string; params: unknown[] }>;
  notifies: string[];
}

function stubPool() {
  const cap: Captured = { inserts: [], notifies: [] };
  const record = (sql: string, params?: unknown[]) => {
    cap.inserts.push({ sql, params: params ?? [] });
  };
  const pool = {
    async query(sql: string, params?: unknown[]) {
      record(sql, params);
      if (sql.startsWith('INSERT INTO messages')) return { rowCount: 1, rows: [{ id: 'msg-out-1' }] };
      if (sql.startsWith('SELECT pg_notify')) {
        cap.notifies.push(String(params?.[1]));
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
    // publishEvent usa client dedicado (BEGIN/COMMIT + INSERTs na mesma tx)
    async connect() {
      return {
        query: async (sql: string, params?: unknown[]) => {
          record(sql, params);
          if (sql.startsWith('INSERT INTO events')) return { rowCount: 1, rows: [{ event_id: 'evt-1', correlation_id: 'corr-1' }] };
          return { rowCount: 0, rows: [] };
        },
        release: async () => {},
      };
    },
  } as never;
  return { pool, cap };
}

function fakeLive(replies: string[], failAt?: number) {
  const calls: Array<{ session_key: string; prompt: string }> = [];
  let n = 0;
  return {
    calls,
    async sendTurn(req: { session_key: string; prompt: string }) {
      calls.push(req);
      n++;
      if (failAt === n) throw new Error('live brain caiu');
      return { reply_text: replies[Math.min(n, replies.length) - 1]!, session_id: 's', duration_ms: 1 };
    },
  };
}

const job = (over: Partial<JobRow> = {}): JobRow =>
  ({
    id: 'job-1',
    job_type: 'investigate',
    payload: {
      objective: 'verificar quota do LLM',
      context_summary: 'ctx',
      conversation_id: '22222222-2222-2222-2222-222222222222',
      client_id: '11111111-1111-1111-1111-111111111111',
      correlation_id: 'corr-1',
      chat_id: '🏆Production - 2026🙏🏻',
      budget: 3,
      timeout_ms: 600_000,
    },
    status: 'running',
    priority: 5,
    attempts: 1,
    max_attempts: 1,
    idempotency_key: 'k',
    ...over,
  }) as JobRow;

describe('investigate (HANDOFF_LIVE real, P2)', () => {
  it('budget de rondas → última ronda vira RESPOSTA FINAL entregue no thread (messages + NOTIFY)', async () => {
    const { pool, cap } = stubPool();
    const live = fakeLive(['descobri X, falta Y', 'RESPOSTA FINAL: quota ok']);
    const h = createInvestigateHandler({ pool, live: live as never, log });
    await h(job({ payload: { ...(job().payload as object), budget: 2 } }), { recordActivity: async () => {} });

    expect(live.calls).toHaveLength(2);
    expect(live.calls[0]!.session_key).toBe('investigate:job-1');
    // 1ª ronda NÃO pede resposta final; última pede
    expect(live.calls[0]!.prompt).not.toContain('RESPOSTA FINAL');
    expect(live.calls[1]!.prompt).toContain('RESPOSTA FINAL');

    const msg = cap.inserts.find((i) => i.sql.startsWith('INSERT INTO messages'));
    expect(msg).toBeDefined();
    expect((msg!.params[1] as string)).toBe('RESPOSTA FINAL: quota ok');
    expect(cap.notifies).toEqual(['msg-out-1']); // send-safety: NOTIFY luna_outbound

    const roundEvents = cap.inserts.filter((i) => i.sql.startsWith('INSERT INTO events'));
    expect(roundEvents.length).toBeGreaterThanOrEqual(2); // §11 round + completed
    const types = roundEvents.map((i) => (i.params[1] as string) ?? '');
    expect(types).toContain('router.investigation.round');
    expect(types).toContain('router.investigation.completed');
  });

  it('live brain declara NÃO RESOLVIDO antes do budget → ESCALATE com resumo das rondas', async () => {
    const { pool, cap } = stubPool();
    const live = fakeLive(['NÃO RESOLVIDO: logs inacessíveis']);
    const h = createInvestigateHandler({ pool, live: live as never, log });
    await h(job(), { recordActivity: async () => {} });

    const esc = cap.inserts.find((i) => i.sql.startsWith('INSERT INTO escalations'));
    expect(esc).toBeDefined();
    expect((esc!.params[2] as string)).toContain('verificar quota');
    expect(JSON.stringify(esc!.params[3])).toContain('NÃO RESOLVIDO');
    // NÃO entregou resposta no thread
    expect(cap.inserts.some((i) => i.sql.startsWith('INSERT INTO messages'))).toBe(false);
    const types = cap.inserts.filter((i) => i.sql.startsWith('INSERT INTO events')).map((i) => String(i.params[1]));
    expect(types).toContain('router.investigation.exhausted');
  });

  it('ronda falha com zero rondas concluídas → erro propaga (visibilidade via job.failed)', async () => {
    const { pool } = stubPool();
    const live = fakeLive([], 1); // 1ª ronda explode
    const h = createInvestigateHandler({ pool, live: live as never, log });
    await expect(h(job(), { recordActivity: async () => {} })).rejects.toThrow('live brain caiu');
  });

  it('ronda falha DEPOIS de rondas ok → ESCALATE com o que foi descoberto', async () => {
    const { pool, cap } = stubPool();
    const live = fakeLive(['achei o arquivo de config'], 2);
    const h = createInvestigateHandler({ pool, live: live as never, log });
    await h(job(), { recordActivity: async () => {} });
    const esc = cap.inserts.find((i) => i.sql.startsWith('INSERT INTO escalations'));
    expect(esc).toBeDefined();
    expect(JSON.stringify(esc!.params[3])).toContain('achei o arquivo');
  });
});

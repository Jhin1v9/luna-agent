import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createInvestigateHandler } from './investigate.js';
import type { JobRow } from './poller.js';

/**
 * Investigação HANDOFF_LIVE — ENVIO ÚNICO (decreto owner 2026-09-26:
 * "enviar só 1x, depois esquece"). Pool e live brain INJETADOS: sem
 * Postgres real e sem CLI real na suíte.
 */

const log = pino({ level: 'silent' });

interface Captured {
  inserts: Array<{ sql: string; params: unknown[] }>;
  notifies: string[];
}

interface StubOptions {
  /** devolve uma linha no dedupe por objetivo (simula job anterior nas 24h) */
  duplicateJob?: { id: string };
  /** devolve uma linha na checagem de idempotency_keys (simula despacho já feito) */
  dispatchAlreadySeen?: boolean;
}

function stubPool(opts: StubOptions = {}) {
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
      if (sql.startsWith('SELECT payload FROM events')) {
        return {
          rowCount: 1,
          rows: [
            {
              payload: {
                event_id: 'evt_previo',
                event_type: 'router.investigation.dispatched',
                version: 1,
                timestamp: new Date().toISOString(),
                source: 'live_investigation',
                organization_id: null,
                client_id: null,
                conversation_id: null,
                correlation_id: 'corr-1',
                causation_id: null,
                priority: 0,
                payload: {},
                metadata: {},
              },
            },
          ],
        };
      }
      if (sql.includes('FROM jobs') && opts.duplicateJob) {
        return { rowCount: 1, rows: [{ id: opts.duplicateJob.id }] };
      }
      return { rowCount: 0, rows: [] };
    },
    // publishEvent usa client dedicado (BEGIN/COMMIT + INSERTs na mesma tx)
    async connect() {
      return {
        query: async (sql: string, params?: unknown[]) => {
          record(sql, params);
          if (sql.startsWith('INSERT INTO events')) return { rowCount: 1, rows: [{ event_id: 'evt-1', correlation_id: 'corr-1' }] };
          if (sql.startsWith('SELECT event_id FROM idempotency_keys') && opts.dispatchAlreadySeen) {
            return { rowCount: 1, rows: [{ event_id: 'evt-previo' }] };
          }
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
      budget: 3, // legado: ignorado pelo handler single-send
      timeout_ms: 600_000,
    },
    status: 'running',
    priority: 5,
    attempts: 1,
    max_attempts: 1,
    idempotency_key: 'k',
    ...over,
  }) as JobRow;

describe('investigate (HANDOFF_LIVE — envio único, decreto owner 2026-09-26)', () => {
  it('1 sendTurn apenas; reply com CONCLUSAO_PRONTA → entrega só a resposta final no thread', async () => {
    const { pool, cap } = stubPool();
    const live = fakeLive(['investiguei: quota 82%.\nCONCLUSAO_PRONTA: Cota em 82%, tudo saudável.']);
    const h = createInvestigateHandler({ pool, live: live as never, log });
    await h(job(), { recordActivity: async () => {} });

    expect(live.calls).toHaveLength(1); // NUNCA reenvia
    expect(live.calls[0]!.session_key).toBe('investigate:job-1');
    expect(live.calls[0]!.prompt).toContain('TAREFA DESTA INVESTIGAÇÃO');
    expect(live.calls[0]!.prompt).toContain('CONCLUSAO_PRONTA'); // instrui a concluir na única chamada

    const msg = cap.inserts.find((i) => i.sql.startsWith('INSERT INTO messages'));
    expect(msg).toBeDefined();
    expect(msg!.params[1] as string).toBe('Cota em 82%, tudo saudável.');
    expect(cap.notifies).toEqual(['msg-out-1']); // send-safety: NOTIFY luna_outbound

    const types = cap.inserts.filter((i) => i.sql.startsWith('INSERT INTO events')).map((i) => String(i.params[1]));
    expect(types).toContain('router.investigation.dispatched');
    expect(types).toContain('router.investigation.round');
    expect(types).toContain('router.investigation.completed');
  });

  it('sem marcador CONCLUSAO_PRONTA → entrega a resposta como veio (única tentativa)', async () => {
    const { pool, cap } = stubPool();
    const live = fakeLive(['quota ok, nada a fazer']);
    const h = createInvestigateHandler({ pool, live: live as never, log });
    await h(job(), { recordActivity: async () => {} });

    expect(live.calls).toHaveLength(1);
    const msg = cap.inserts.find((i) => i.sql.startsWith('INSERT INTO messages'));
    expect((msg!.params[1] as string).includes('quota ok')).toBe(true);
  });

  it('falha/timeout do envio → ESCALATE e o job COMPLETA (não propaga, sem retry/reenvio)', async () => {
    const { pool, cap } = stubPool();
    const live = fakeLive([], 1); // explode no único envio
    const h = createInvestigateHandler({ pool, live: live as never, log });
    // decreto: NÃO rejeita — falha vira escalate, job termina limpo
    await expect(h(job(), { recordActivity: async () => {} })).resolves.toBeUndefined();
    expect(live.calls).toHaveLength(1); // não houve 2ª tentativa

    const esc = cap.inserts.find((i) => i.sql.startsWith('INSERT INTO escalations'));
    expect(esc).toBeDefined();
    expect(JSON.stringify(esc!.params[3])).toContain('live brain caiu');
    expect(cap.inserts.some((i) => i.sql.startsWith('INSERT INTO messages'))).toBe(false);
  });

  it('live brain declara NÃO RESOLVIDO → ESCALATE, nada entregue no thread', async () => {
    const { pool, cap } = stubPool();
    const live = fakeLive(['NÃO RESOLVIDO: logs inacessíveis']);
    const h = createInvestigateHandler({ pool, live: live as never, log });
    await h(job(), { recordActivity: async () => {} });

    expect(live.calls).toHaveLength(1);
    const esc = cap.inserts.find((i) => i.sql.startsWith('INSERT INTO escalations'));
    expect(esc).toBeDefined();
    expect(cap.inserts.some((i) => i.sql.startsWith('INSERT INTO messages'))).toBe(false);
    const types = cap.inserts.filter((i) => i.sql.startsWith('INSERT INTO events')).map((i) => String(i.params[1]));
    expect(types).toContain('router.investigation.exhausted');
  });

  it('dedupe: mesmo objetivo+conversa já enviado nas 24h → 0 sendTurn + evento skipped_duplicate', async () => {
    const { pool, cap } = stubPool({ duplicateJob: { id: 'job-anterior' } });
    const live = fakeLive(['nunca deve ser chamado']);
    const h = createInvestigateHandler({ pool, live: live as never, log });
    await h(job({ id: 'job-novo' }), { recordActivity: async () => {} });

    expect(live.calls).toHaveLength(0); // NENHUM envio — "depois esquece"
    const skip = cap.inserts.find(
      (i) => i.sql.startsWith('INSERT INTO events') && String(i.params[1]).includes('skipped_duplicate'),
    );
    expect(skip).toBeDefined();
    expect(cap.inserts.some((i) => i.sql.startsWith('INSERT INTO messages'))).toBe(false);
  });

  it('reaper double-pick: marca de despacho já existe → 0 sendTurn (sem reenviar o mesmo prompt)', async () => {
    const { pool, cap } = stubPool({ dispatchAlreadySeen: true });
    const live = fakeLive(['nunca deve ser chamado']);
    const h = createInvestigateHandler({ pool, live: live as never, log });
    await h(job(), { recordActivity: async () => {} });

    expect(live.calls).toHaveLength(0);
    expect(cap.inserts.some((i) => i.sql.startsWith('INSERT INTO messages'))).toBe(false);
  });
});

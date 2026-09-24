import { Client } from 'pg';
import type { KimiAdapterConfig, KimiLiveAdapter, SessionInfo, TurnRequest, TurnResult } from './types.js';
import { KimiAdapterError } from './types.js';

/**
 * KimiWorkAdapter — a Luna do Kimi Work como cérebro (decreto owner
 * 2026-09-24, ADR-040). Usado quando Kimi Code/Gemini estão sem quota:
 * o turno vai pra fila `kimiwork_llm_turns` no Postgres e o agente Kimi
 * Work (varredura/cron no workspace) responde por UPDATE na mesma tabela;
 * o adapter faz poll até `answered` (ou timeout explícito — NUNCA cai
 * pro mock). Mesma interface estável KimiLiveAdapter: quem programa
 * contra o adapter não sente a troca de cérebro.
 */

export interface PoolLike {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface KimiWorkAdapterDeps {
  /** Pool injetável (testes). Default: pool próprio a partir de DATABASE_URL. */
  pool?: PoolLike;
  pollIntervalMs?: number;
  timeoutMs?: number;
  /** Sleep injetável (testes). */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class KimiWorkAdapter implements KimiLiveAdapter {
  readonly mode = 'kimiwork' as const;
  private pool: PoolLike;
  private pollIntervalMs: number;
  private timeoutMs: number;
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;
  private ownPool: { end(): Promise<void> } | null = null;

  constructor(_config: KimiAdapterConfig = { mode: 'kimiwork' }, deps: KimiWorkAdapterDeps = {}) {
    this.pool = deps.pool ?? this.createOwnPool();
    this.pollIntervalMs = deps.pollIntervalMs ?? Number(process.env.KIMIWORK_LLM_POLL_MS ?? 2500);
    this.timeoutMs = deps.timeoutMs ?? Number(process.env.KIMIWORK_LLM_TIMEOUT_MS ?? 180_000);
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = deps.now ?? Date.now;
  }

  private createOwnPool(): PoolLike {
    const url = process.env.DATABASE_URL;
    if (!url) throw new KimiAdapterError('kimiwork: DATABASE_URL ausente — não consigo enfileirar o turno');
    const client = new Client({ connectionString: url });
    const ready = client.connect();
    this.ownPool = {
      end: async () => {
        await ready.catch(() => {});
        await client.end().catch(() => {});
      },
    };
    return {
      query: async (text, params) => {
        await ready;
        return client.query(text, params);
      },
    };
  }

  async close(): Promise<void> {
    await this.ownPool?.end();
  }

  async ensureSession(sessionKey: string): Promise<SessionInfo> {
    // Sem sessão real: a "sessão" é a chave estável da conversa (§7.3).
    return { session_id: sessionKey, busy: false };
  }

  async sendTurn(request: TurnRequest): Promise<TurnResult> {
    const idem = `kw:${request.session_key}:${this.now()}`;
    const ins = await this.pool.query(
      `INSERT INTO kimiwork_llm_turns (session_key, prompt, image_base64, idempotency_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [request.session_key, request.prompt, request.image_base64 ?? null, idem],
    );
    let turnId: string;
    if (ins.rows[0] && typeof ins.rows[0] === 'object' && 'id' in ins.rows[0]) {
      turnId = String((ins.rows[0] as { id: unknown }).id);
    } else {
      const dup = await this.pool.query(
        `SELECT id FROM kimiwork_llm_turns WHERE idempotency_key = $1`,
        [idem],
      );
      if (!dup.rows[0]) throw new KimiAdapterError('kimiwork: turno não enfileirado (motivo desconhecido)');
      turnId = String((dup.rows[0] as { id: unknown }).id);
    }

    const t0 = this.now();
    while (this.now() - t0 < this.timeoutMs) {
      const res = await this.pool.query(
        `SELECT status, response, error FROM kimiwork_llm_turns WHERE id = $1`,
        [turnId],
      );
      const row = res.rows[0] as { status: string; response: string | null; error: string | null } | undefined;
      if (row?.status === 'answered' && row.response != null) {
        return {
          reply_text: row.response,
          session_id: request.session_key,
          duration_ms: this.now() - t0,
          model: 'kimi-work-luna',
          provider: 'kimiwork',
        };
      }
      if (row?.status === 'failed') {
        throw new KimiAdapterError(`kimiwork: turno marcado como failed${row.error ? `: ${row.error}` : ''}`);
      }
      await this.sleep(this.pollIntervalMs);
    }
    await this.pool
      .query(`UPDATE kimiwork_llm_turns SET status = 'failed', error = 'timeout do adapter' WHERE id = $1 AND status = 'pending'`, [turnId])
      .catch(() => {});
    throw new KimiAdapterError(
      `kimiwork: resposta não chegou em ${Math.round(this.timeoutMs / 1000)}s — a varredura Kimi Work não atendeu o turno (falha explícita, sem mock)`,
    );
  }

  async readMessages(_sessionKey: string, _afterSeq?: number): Promise<unknown[]> {
    // Run buffer §20 fica pra quando o Kimi Work expuser histórico por sessão.
    return [];
  }
}

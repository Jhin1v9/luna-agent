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
  /** Intervalo entre avisos de progresso enquanto espera a varredura (default 2 min). */
  progressIntervalMs?: number;
  /** Hook de progresso (decreto Jhino 2026-09-24: "vai avisando conforme, de pouco em pouco"). */
  onProgress?: (info: { turnId: string; elapsedMs: number; polls: number }) => void;
  /** Sleep injetável (testes). */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Sem hard-fail por timeout (decreto Jhino 2026-09-24): o turno fica
 * aguardando a varredura e VAI AVISANDO de pouco em pouco (log estruturado +
 * hook onProgress — o orchestrator pode plugar aviso ao time). O cap de 12h é
 * só segurança anti-lock eterno (um turno preso segura o client lock §19);
 * na prática nunca é atingido.
 */
const SAFETY_CAP_MS = 43_200_000; // 12h — segurança, não é "timeout de operação"
const PROGRESS_DEFAULT_MS = 120_000; // aviso a cada 2 min

export class KimiWorkAdapter implements KimiLiveAdapter {
  readonly mode = 'kimiwork' as const;
  private pool: PoolLike;
  private pollIntervalMs: number;
  private timeoutMs: number;
  private progressIntervalMs: number;
  private onProgress?: (info: { turnId: string; elapsedMs: number; polls: number }) => void;
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;
  private ownPool: { end(): Promise<void> } | null = null;

  constructor(_config: KimiAdapterConfig = { mode: 'kimiwork' }, deps: KimiWorkAdapterDeps = {}) {
    this.pool = deps.pool ?? this.createOwnPool();
    this.pollIntervalMs = deps.pollIntervalMs ?? Number(process.env.KIMIWORK_LLM_POLL_MS ?? 2500);
    this.timeoutMs = deps.timeoutMs ?? Number(process.env.KIMIWORK_LLM_TIMEOUT_MS ?? SAFETY_CAP_MS);
    this.progressIntervalMs = deps.progressIntervalMs ?? Number(process.env.KIMIWORK_LLM_PROGRESS_MS ?? PROGRESS_DEFAULT_MS);
    this.onProgress = deps.onProgress;
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
    // ROTEADOR DE CHAT (decreto owner 2026-09-24): turnos de voz
    // (conductora da chamada + pré-voo do Operador) têm resposta na
    // automação "Luna — Voz"; o restante na "Luna — Geral". Derivação por
    // prefixo da session_key — quem programa contra o adapter não precisa
    // saber que chats existem (migração 011 criou a coluna channel).
    const channel = /^(conductor|operator):/.test(request.session_key) ? 'voice' : 'geral';
    const ins = await this.pool.query(
      `INSERT INTO kimiwork_llm_turns (session_key, prompt, image_base64, idempotency_key, channel)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [request.session_key, request.prompt, request.image_base64 ?? null, idem, channel],
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
    let polls = 0;
    let lastProgressAt = t0;
    while (this.now() - t0 < this.timeoutMs) {
      polls += 1;
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
      // Decreto Jhino 2026-09-24: sem silêncio longo — avisa de pouco em pouco.
      if (this.now() - lastProgressAt >= this.progressIntervalMs) {
        lastProgressAt = this.now();
        const info = { turnId, elapsedMs: this.now() - t0, polls };
        this.onProgress?.(info);
        console.warn(
          JSON.stringify({ level: 'warn', msg: 'kimiwork: turno aguardando varredura', turn_id: turnId, elapsed_ms: info.elapsedMs, polls }),
        );
      }
      await this.sleep(this.pollIntervalMs);
    }
    // Cap de segurança (12h) — lock do client não pode ficar preso eternamente.
    await this.pool
      .query(`UPDATE kimiwork_llm_turns SET status = 'failed', error = 'cap de segurança atingido (12h) aguardando a varredura' WHERE id = $1 AND status = 'pending'`, [turnId])
      .catch(() => {});
    throw new KimiAdapterError(
      `kimiwork: cap de segurança de 12h atingido aguardando a varredura (turno ${turnId}) — investigar varredura/sweep`,
    );
  }

  async readMessages(_sessionKey: string, _afterSeq?: number): Promise<unknown[]> {
    // Run buffer §20 fica pra quando o Kimi Work expuser histórico por sessão.
    return [];
  }
}

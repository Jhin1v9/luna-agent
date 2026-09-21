import type { Pool } from 'pg';
import { validateEvent, type EventEnvelope, type CreateEventInput } from '@luna/events';
import { recordAudit, publishEvent } from '@luna/database';

/**
 * Event bus do Orchestrator (§7.1 módulo `events/`, §7.8 outbox, §7.7 DLQ,
 * §7.6 idempotência).
 *
 * Fluxo do publish (UMA transação — estado + evento jamais se separam):
 *   valida envelope → grava em `events` → grava em `outbox`
 *   → registra idempotency_key (se houver) → commit.
 *
 * Fluxo do dispatcher (poll em `outbox`):
 *   pega lote (FOR UPDATE SKIP LOCKED) → roda handlers locais
 *   → ok: marca published · falha: backoff exponencial → DLQ após max tentativas.
 *
 * O "transporte" para outros processos (worker) é a tabela `jobs` — enfileirar
 * um job a partir de um handler continua sendo SQL na mesma conexão de produtor.
 */

export type EventHandler = (event: EventEnvelope) => void | Promise<void>;

export interface PublishInput extends CreateEventInput {
  /** Chave de idempotência (§7.6). Mesma chave nunca executa 2x. */
  idempotency_key?: string;
}

export interface PublishResult {
  event: EventEnvelope;
  /** true quando a idempotency_key já existia — evento original devolvido. */
  duplicate: boolean;
}

export interface EventBusOptions {
  /** Nome do despachante, vai para logs/audit. */
  dispatcherId?: string;
  /** Intervalo do loop de dispatch em ms (default 200). */
  dispatchIntervalMs?: number;
  /** Máx. de tentativas de dispatch antes da DLQ (default 5). */
  maxAttempts?: number;
  /** Backoff base em ms — dobra a cada tentativa (default 500). */
  baseBackoffMs?: number;
  /** Lote por ciclo de dispatch (default 20). */
  batchSize?: number;
}

/** Backoff exponencial: 1ª falha espera base, depois dobra. */
export function backoffMs(attempts: number, base = 500): number {
  return base * 2 ** Math.max(0, attempts - 1);
}

interface OutboxRow {
  id: string;
  event_id: string;
  event_type: string;
  payload: unknown;
  status: string;
  attempts: number;
}

function errorStack(err: unknown): { message: string; stack: string | null } {
  if (err instanceof Error) return { message: err.message, stack: err.stack ?? null };
  return { message: String(err), stack: null };
}

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private timer: NodeJS.Timeout | null = null;
  private readonly dispatcherId: string;
  private readonly dispatchIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly pool: Pool,
    opts: EventBusOptions = {},
  ) {
    this.dispatcherId = opts.dispatcherId ?? 'orchestrator';
    this.dispatchIntervalMs = opts.dispatchIntervalMs ?? 200;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.baseBackoffMs = opts.baseBackoffMs ?? 500;
    this.batchSize = opts.batchSize ?? 20;
  }

  /** Registra handler para um event_type. '*' = todos. Retorna unsubscribe. */
  on(eventType: string, handler: EventHandler): () => void {
    let set = this.handlers.get(eventType);
    if (!set) this.handlers.set(eventType, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }

  /**
   * Publica um evento: envelope validado, persistido em `events` + `outbox`
   * e idempotency_key registrada — tudo na mesma transação (§7.8).
   * Delega ao publisher compartilhado do @luna/database (mesmo caminho
   * usado pelo WhatsPlay e por scripts).
   */
  async publish(input: PublishInput): Promise<PublishResult> {
    return publishEvent(this.pool, input);
  }

  private async runHandlers(event: EventEnvelope): Promise<void> {
    const specific = this.handlers.get(event.event_type);
    const wildcard = this.handlers.get('*');
    for (const handler of [...(specific ?? []), ...(wildcard ?? [])]) {
      await handler(event);
    }
  }

  /**
   * Um ciclo de dispatch: publica o que está pendente no outbox.
   * Eventos sem handler registrado são apenas marcados como published
   * (persistidos em `events` — a fonte da verdade — e auditados).
   */
  async dispatchOnce(): Promise<number> {
    const claimed = await this.pool.query<OutboxRow>(
      `WITH picked AS (
         SELECT id FROM outbox
         WHERE status = 'pending' AND next_retry_at <= now()
         ORDER BY occurred_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE outbox o
       SET status = 'running', locked_at = now(), attempts = o.attempts + 1
       FROM picked WHERE o.id = picked.id
       RETURNING o.*`,
      [this.batchSize],
    );

    for (const row of claimed.rows) {
      const startedAt = Date.now();
      let event: EventEnvelope;
      try {
        event = validateEvent(row.payload);
      } catch (err) {
        // Payload inválido (evento não-envelope): mata na hora, vai pra DLQ —
        // nunca fica 'running' preso esperando o reaper.
        const { message, stack } = errorStack(err);
        await this.pool.query(
          `UPDATE outbox SET status = 'dead', locked_at = NULL WHERE id = $1`,
          [row.id],
        );
        await this.pool.query(
          `INSERT INTO dead_letter_events
             (event_id, event_type, source, payload, reason, last_error, attempts, stack)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [row.event_id, row.event_type, this.dispatcherId, row.payload, 'invalid_envelope', message, row.attempts, stack],
        );
        await recordAudit(this.pool, {
          actor: this.dispatcherId,
          action: 'event.dispatched',
          tool: 'event_bus',
          result: 'failed',
          duration_ms: Date.now() - startedAt,
          metadata: { event_id: row.event_id, error: message, reason: 'invalid_envelope' },
        });
        continue;
      }
      try {
        await this.runHandlers(event);
        await this.pool.query(
          `UPDATE outbox SET status = 'published', published_at = now(), locked_at = NULL
           WHERE id = $1`,
          [row.id],
        );
        await recordAudit(this.pool, {
          actor: this.dispatcherId,
          action: 'event.dispatched',
          tool: 'event_bus',
          client_id: event.client_id,
          correlation_id: event.correlation_id,
          duration_ms: Date.now() - startedAt,
          result: 'success',
          metadata: { event_id: event.event_id, event_type: event.event_type },
        });
      } catch (err) {
        const { message, stack } = errorStack(err);
        const attempts = row.attempts; // já incrementado pelo UPDATE
        await recordAudit(this.pool, {
          actor: this.dispatcherId,
          action: 'event.dispatched',
          tool: 'event_bus',
          client_id: event.client_id,
          correlation_id: event.correlation_id,
          duration_ms: Date.now() - startedAt,
          result: 'failed',
          metadata: {
            event_id: event.event_id,
            event_type: event.event_type,
            error: message,
            attempts,
          },
        });
        if (attempts >= this.maxAttempts) {
          await this.pool.query(
            `UPDATE outbox SET status = 'dead', locked_at = NULL WHERE id = $1`,
            [row.id],
          );
          await this.pool.query(
            `INSERT INTO dead_letter_events
               (event_id, event_type, source, payload, reason, last_error, attempts, stack)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [event.event_id, event.event_type, this.dispatcherId, event, 'handler_failed', message, attempts, stack],
          );
        } else {
          const retryAt = new Date(Date.now() + backoffMs(attempts, this.baseBackoffMs));
          await this.pool.query(
            `UPDATE outbox SET status = 'pending', locked_at = NULL, next_retry_at = $2
             WHERE id = $1`,
            [row.id, retryAt],
          );
        }
      }
    }
    return claimed.rows.length;
  }

  /** Loop contínuo de dispatch. Chamar stop() no shutdown. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.dispatchOnce().catch(() => {
        // Erros de ciclo (ex.: pg temporariamente fora) são deixados para o
        // próximo ciclo; o health/readiness é a fonte de verdade da DB.
      });
    }, this.dispatchIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

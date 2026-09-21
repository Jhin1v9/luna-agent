import type { Pool } from 'pg';
import { createEvent, validateEvent, type EventEnvelope, type CreateEventInput } from '@luna/events';

/**
 * Publisher compartilhado — qualquer processo (orchestrator, whatsplay, scripts)
 * publica eventos pelo MESMO caminho transacional do bus (§7.8):
 *   envelope → `events` → `outbox` → `idempotency_keys` numa única transação.
 * O EventBus do orchestrator delega para cá; consumidores despacham pelo outbox.
 */

export interface PublishInput extends CreateEventInput {
  /** Chave de idempotência (§7.6). Mesma chave nunca executa 2x. */
  idempotency_key?: string;
}

export interface PublishResult {
  event: EventEnvelope;
  /** true quando a idempotency_key já existia — evento original devolvido. */
  duplicate: boolean;
}

async function fetchEvent(db: Pool, eventId: string): Promise<EventEnvelope> {
  const res = await db.query<{ payload: unknown }>(
    'SELECT payload FROM events WHERE event_id = $1',
    [eventId],
  );
  if (!res.rowCount) throw new Error(`evento ${eventId} não encontrado em events`);
  return validateEvent(res.rows[0]!.payload);
}

export async function publishEvent(db: Pool, input: PublishInput): Promise<PublishResult> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    if (input.idempotency_key) {
      const seen = await client.query<{ event_id: string }>(
        'SELECT event_id FROM idempotency_keys WHERE key = $1',
        [input.idempotency_key],
      );
      if (seen.rowCount && seen.rowCount > 0) {
        await client.query('COMMIT');
        return { event: await fetchEvent(db, seen.rows[0]!.event_id), duplicate: true };
      }
    }

    const event = createEvent(input);
    await client.query(
      `INSERT INTO events
         (event_id, event_type, version, organization_id, client_id,
          conversation_id, correlation_id, causation_id, priority, payload, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        event.event_id,
        event.event_type,
        event.version,
        event.organization_id,
        event.client_id,
        event.conversation_id,
        event.correlation_id,
        event.causation_id,
        event.priority,
        event,
        event.timestamp,
      ],
    );
    await client.query(
      `INSERT INTO outbox (event_id, event_type, payload, occurred_at)
       VALUES ($1, $2, $3, $4)`,
      [event.event_id, event.event_type, event, event.timestamp],
    );
    if (input.idempotency_key) {
      await client.query(
        'INSERT INTO idempotency_keys (key, event_id) VALUES ($1, $2)',
        [input.idempotency_key, event.event_id],
      );
    }

    await client.query('COMMIT');
    return { event, duplicate: false };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

import type { Pool, PoolClient } from 'pg';
import type { Logger } from 'pino';
import type { EventEnvelope } from '@luna/events';
import type { KimiLiveAdapter } from '@luna/agent';
import { recordActivity, recordAudit, type Sql } from '@luna/database';
import { buildClientConversationPack, renderConversationPrompt } from './context.js';
import { transitionConversation } from './attention.js';

/**
 * Handler de mensagens de cliente (client.message.received do simulador e
 * whatsapp.message.received do WhatsPlay) — o ciclo vivo (§7.1 módulo agent/):
 *
 *   evento → client lock (advisory lock por conversa, §19)
 *          → estado AI_HANDLING (persistido, §7.11)
 *          → Context Builder (pack CLIENT_CONVERSATION, §7.9)
 *          → brain REAL via adapter (kimi-api na produção — mock só dev/teste, ADR-016)
 *          → resposta em messages (outbound, send_state queued → WhatsPlay entrega)
 *          → usage_entries quando o backend informa tokens (§23)
 *          → agent_runs + activity (humano) + audit (máquina, com correlation_id)
 *          → estado RESOLVED
 *
 * Idempotência dupla: publish deduplica por idempotency_key (§7.6) e a resposta
 * gravada leva metadata.reply_to_event — reprocessamento do mesmo evento é
 * detectado e ignorado (retry nunca gera segunda resposta ao cliente).
 */

export interface MessageHandlerDeps {
  pool: Pool;
  adapter: KimiLiveAdapter;
  log: Logger;
}

interface HandlerPayload {
  conversation_id?: string;
  text?: string;
  /** Quem falou (nome do membro no grupo / contato no privado). */
  author_name?: string | null;
  /** true = mensagem de canal real (WhatsPlay entrega); false = simulação. */
  deliver?: boolean;
}

export function createMessageHandler(deps: MessageHandlerDeps) {
  const { pool, adapter, log } = deps;

  async function processLocked(
    db: Sql & Pick<PoolClient, 'query'>,
    event: EventEnvelope,
    payload: HandlerPayload,
  ): Promise<void> {
    const conversationId = payload.conversation_id!;
    const text = payload.text ?? '';

    // Reprocessamento (retry do dispatcher)? Resposta já existe → ignora.
    const already = await db.query(
      `SELECT id FROM messages
       WHERE conversation_id = $1 AND direction = 'outbound'
         AND metadata->>'reply_to_event' = $2
       LIMIT 1`,
      [conversationId, event.event_id],
    );
    if (already.rowCount) {
      log.info({ event_id: event.event_id }, 'resposta já existe — evento duplicado ignorado');
      await recordAudit(db, {
        actor: 'orchestrator',
        action: 'agent.reply.duplicate_ignored',
        tool: 'message_handler',
        correlation_id: event.correlation_id,
        result: 'success',
        metadata: { event_id: event.event_id },
      });
      return;
    }

    const runStartedAt = new Date();
    await transitionConversation(db, conversationId, 'AI_HANDLING');

    const pack = await buildClientConversationPack(db, conversationId);
    const prompt = renderConversationPrompt(pack, text);

    // Brain real. Se falhar: erro sobe pro dispatcher (retry → DLQ), nunca
    // fallback silencioso pro mock (ADR-016).
    const turn = await adapter.sendTurn({ session_key: conversationId, prompt });

    // Resposta persistida. deliver=false (simulação) não entra na fila de envio.
    const deliver = payload.deliver !== false;
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO messages (conversation_id, direction, channel, sender, body, author_name, metadata, send_state)
       VALUES ($1, 'outbound', $2, 'luna', $3, 'Luna', $4, $5)
       RETURNING id`,
      [
        conversationId,
        pack.channel,
        turn.reply_text,
        { reply_to_event: event.event_id, correlation_id: event.correlation_id, adapter: adapter.mode },
        deliver ? 'queued' : 'simulated',
      ],
    );
    const replyMessageId = inserted.rows[0]!.id;

    // Avisa o WhatsPlay (LISTEN/NOTIFY) sem poluir o log binário da fila.
    if (deliver) {
      await db.query('SELECT pg_notify($1, $2)', ['luna_outbound', replyMessageId]);
    }

    // Usage ledger (§23): entrada real por resposta gerada.
    if (turn.usage) {
      await db.query(
        `INSERT INTO usage_entries (client_id, event_id, provider, model, input_tokens, output_tokens)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          event.client_id,
          event.event_id,
          adapter.mode === 'kimi-api' ? 'kimi-api' : adapter.mode,
          adapter.mode === 'kimi-api' ? 'kimi-k2' : adapter.mode,
          turn.usage.input_tokens,
          turn.usage.output_tokens,
        ],
      );
    }

    const finishedAt = new Date();
    await db.query(
      `INSERT INTO agent_runs (event_id, client_id, agent, brain, status, input, output, started_at, finished_at)
       VALUES ($1, $2, 'luna', $3, 'completed', $4, $5, $6, $7)`,
      [
        event.event_id,
        event.client_id,
        adapter.mode,
        { prompt_lines: prompt.split('\n').length, pack: { client: pack.client_name, channel: pack.channel } },
        { reply_text: turn.reply_text, session_id: turn.session_id, reply_message_id: replyMessageId },
        runStartedAt,
        finishedAt,
      ],
    );

    await transitionConversation(db, conversationId, 'RESOLVED');

    // §20 — activity (humano) + audit (máquina), correlation_id presente.
    // Activity cita o AUTOR da mensagem quando conhecido (decreto owner:
    // "registrar quem falou o quê") — no grupo fica "Respondi Abner (grupo)".
    const snippet = text.length > 60 ? `${text.slice(0, 60)}…` : text;
    const author = payload.author_name ?? pack.contact_name ?? pack.client_name;
    await recordActivity(db, {
      client_id: event.client_id,
      kind: 'action',
      summary: `Respondi ${author} (${pack.client_name}): "${snippet}"`,
      correlation_id: event.correlation_id,
    });
    await recordAudit(db, {
      actor: 'orchestrator',
      action: 'agent.run.completed',
      tool: 'kimi_adapter',
      client_id: event.client_id,
      correlation_id: event.correlation_id,
      duration_ms: turn.duration_ms,
      result: 'success',
      metadata: {
        event_id: event.event_id,
        conversation_id: conversationId,
        adapter: adapter.mode,
        reply_chars: turn.reply_text.length,
        deliver,
      },
    });

    log.info(
      { event_id: event.event_id, correlation_id: event.correlation_id, conversation_id: conversationId, adapter: adapter.mode },
      'cliente respondido',
    );
  }

  return async function handleClientMessage(event: EventEnvelope): Promise<void> {
    const payload = event.payload as HandlerPayload;
    const conversationId = payload.conversation_id;
    if (!conversationId) {
      throw new Error(`${event.event_type} sem conversation_id no payload`);
    }

    // Client lock (§19): mensagens da mesma conversa se processam em série;
    // clientes diferentes, em paralelo. Lock transacional Postgres.
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [
        `luna:conv:${conversationId}`,
      ]);
      await processLocked(client, event, payload);
    } finally {
      await client
        .query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [`luna:conv:${conversationId}`])
        .catch(() => {});
      client.release();
    }
  };
}

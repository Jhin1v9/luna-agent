import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { EventEnvelope } from '@luna/events';
import type { KimiLiveAdapter } from '@luna/agent';
import { recordActivity, recordAudit } from '@luna/database';
import { buildClientConversationPack, renderConversationPrompt } from './context.js';
import { transitionConversation } from './attention.js';

/**
 * Handler de client.message.received — o ciclo vivo (§7.1 módulo `agent/`):
 *
 *   evento → estado AI_HANDLING (persistido, §7.11)
 *          → Context Builder (pack CLIENT_CONVERSATION, §7.9)
 *          → sessão Kimi persistente via adapter (sendTurn)
 *          → resposta gravada em messages (outbound, sender=luna)
 *          → agent_runs + activity (humano) + audit (máquina, com correlation_id)
 *          → estado RESOLVED
 *
 * Idempotência dupla: a publish já deduplica por idempotency_key (§7.6) e,
 * como o dispatcher do outbox retenta handlers, a resposta gravada leva
 * metadata.reply_to_event — reprocessamento do mesmo evento é detectado e
 * ignorado (duplicata nunca gera segunda resposta ao cliente).
 */

export interface MessageHandlerDeps {
  pool: Pool;
  adapter: KimiLiveAdapter;
  log: Logger;
}

interface HandlerPayload {
  conversation_id?: string;
  text?: string;
}

export function createMessageHandler(deps: MessageHandlerDeps) {
  const { pool, adapter, log } = deps;

  return async function handleClientMessage(event: EventEnvelope): Promise<void> {
    const payload = event.payload as HandlerPayload;
    const conversationId = payload.conversation_id;
    const text = payload.text ?? '';
    if (!conversationId) {
      throw new Error('client.message.received sem conversation_id no payload');
    }

    // Reprocessamento (retry do dispatcher)? Resposta já existe → ignora.
    const already = await pool.query(
      `SELECT id FROM messages
       WHERE conversation_id = $1 AND direction = 'outbound'
         AND metadata->>'reply_to_event' = $2
       LIMIT 1`,
      [conversationId, event.event_id],
    );
    if (already.rowCount) {
      log.info({ event_id: event.event_id }, 'resposta já existe — evento duplicado ignorado');
      await recordAudit(pool, {
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
    await transitionConversation(pool, conversationId, 'AI_HANDLING');

    const pack = await buildClientConversationPack(pool, conversationId);
    const prompt = renderConversationPrompt(pack, text);

    const turn = await adapter.sendTurn({
      session_key: conversationId,
      prompt,
    });

    // Resposta persistida — mensagem outbound ligada ao evento que a gerou.
    await pool.query(
      `INSERT INTO messages (conversation_id, direction, channel, sender, body, metadata)
       VALUES ($1, 'outbound', $2, 'luna', $3, $4)`,
      [
        conversationId,
        pack.channel,
        turn.reply_text,
        { reply_to_event: event.event_id, correlation_id: event.correlation_id, adapter: adapter.mode },
      ],
    );

    const finishedAt = new Date();
    await pool.query(
      `INSERT INTO agent_runs (event_id, client_id, agent, brain, status, input, output, started_at, finished_at)
       VALUES ($1, $2, 'luna', $3, 'completed', $4, $5, $6, $7)`,
      [
        event.event_id,
        event.client_id,
        adapter.mode,
        { prompt_lines: prompt.split('\n').length, pack: { client: pack.client_name, channel: pack.channel } },
        { reply_text: turn.reply_text, session_id: turn.session_id },
        runStartedAt,
        finishedAt,
      ],
    );

    await transitionConversation(pool, conversationId, 'RESOLVED');

    // §20 — activity (humano) + audit (máquina), correlation_id presente.
    const snippet = text.length > 60 ? `${text.slice(0, 60)}…` : text;
    await recordActivity(pool, {
      client_id: event.client_id,
      kind: 'action',
      summary: `Respondi ${pack.contact_name ?? pack.client_name} (${pack.client_name}): "${snippet}"`,
      correlation_id: event.correlation_id,
    });
    await recordAudit(pool, {
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
      },
    });

    log.info(
      { event_id: event.event_id, correlation_id: event.correlation_id, conversation_id: conversationId },
      'cliente respondido',
    );
  };
}

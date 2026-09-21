import type { Pool } from 'pg';
import { resolveIngressIdentity, insertInboundMessage, publishEvent, recordAudit } from '@luna/database';
import type { Logger } from 'pino';
import type { UnreadMessage, WhatsAppTransport } from './transport.js';
import { shouldRespond } from './rules.js';

/**
 * Ingestão (§13 event-driven): mensagem nova capturada por mutação de DOM →
 * normalizada → regras de grupo (§5) → idempotente → publica
 * whatsapp.message.received. O orchestrator despacha pro handler da Luna.
 */

export interface IngestDeps {
  pool: Pool;
  transport: WhatsAppTransport;
  log: Logger;
}

export function createIngest(deps: IngestDeps) {
  const { pool, log } = deps;

  /** Uma mensagem inbound (já pós-debounce). */
  async function ingestOne(msg: UnreadMessage): Promise<'published' | 'skipped'> {
    if (
      !shouldRespond({
        is_group: msg.is_group,
        text: msg.text,
        mentioned_luna: msg.mentioned_luna,
        reply_to_luna: msg.quoted_from_luna ?? false,
      })
    ) {
      log.debug({ chat: msg.chat_name }, 'grupo sem menção/reply — silêncio absoluto (§5)');
      return 'skipped';
    }

    const identity = await resolveIngressIdentity(pool, {
      client_name: msg.chat_name,
      contact_name: msg.chat_name,
      channel: 'whatsapp',
      address: msg.chat_id,
    });

    const messageId = await insertInboundMessage(pool, {
      conversation_id: identity.conversation_id,
      channel: 'whatsapp',
      text: msg.text,
      external_id: msg.external_id,
      author_name: msg.author_name ?? msg.chat_name,
    });
    if (!messageId) {
      log.info({ external_id: msg.external_id }, 'mensagem duplicada — ignorada (§7.6)');
      return 'skipped';
    }

    const { event } = await publishEvent(pool, {
      event_type: 'whatsapp.message.received',
      source: 'whatsplay',
      client_id: identity.client_id,
      conversation_id: identity.conversation_id,
      payload: {
        conversation_id: identity.conversation_id,
        message_id: messageId,
        text: msg.text,
        author_name: msg.author_name ?? msg.chat_name,
        is_group: msg.is_group,
        deliver: true,
        chat_id: msg.chat_id,
      },
      idempotency_key: `wa:msg:${msg.external_id}`,
    });

    await recordAudit(pool, {
      actor: 'whatsplay',
      action: 'whatsapp.message.ingested',
      tool: 'whatsplay_ingest',
      client_id: identity.client_id,
      correlation_id: event.correlation_id,
      result: 'success',
      metadata: { external_id: msg.external_id, chat_id: msg.chat_id, is_group: msg.is_group },
    });

    log.info({ correlation_id: event.correlation_id, chat: msg.chat_name }, 'mensagem ingerida');
    return 'published';
  }

  return { ingestOne };
}

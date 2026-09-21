import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from 'pino';
import { resolveIngressIdentity, insertInboundMessage } from '@luna/database';
import type { EventBus } from '../events/bus.js';

/**
 * Endpoint de TESTE (montado só fora de produção): simula uma mensagem de
 * cliente entrando — o ingress real do WhatsPlay chegou na F1.4 e publica
 * whatsapp.message.received pelo mesmo publisher compartilhado.
 *
 *   POST /test/simulate-message
 *   { client_name, contact_name?, channel?, address?, text, external_id? }
 */

export interface SimulateInput {
  client_name: string;
  contact_name?: string;
  channel?: string;
  address?: string;
  text: string;
  external_id?: string;
}

export interface SimulateResult {
  duplicate: boolean;
  conversation_id: string;
  message_id: string | null;
  event_id: string | null;
  correlation_id: string | null;
}

/** Simula o ingress de mensagem de cliente. Usado pelo endpoint e pelos testes. */
export async function simulateMessage(
  pool: Pool,
  bus: EventBus,
  input: SimulateInput,
): Promise<SimulateResult> {
  const channel = input.channel ?? 'whatsapp';
  const address = input.address ?? `+55-test-${input.client_name.toLowerCase()}`;
  const externalId = input.external_id ?? `sim-${randomUUID()}`;

  const identity = await resolveIngressIdentity(pool, {
    client_name: input.client_name,
    contact_name: input.contact_name ?? null,
    channel,
    address,
  });

  // Mensagem inbound — unique (channel, external_id) devolve duplicata.
  const messageId = await insertInboundMessage(pool, {
    conversation_id: identity.conversation_id,
    channel,
    text: input.text,
    external_id: externalId,
  });
  if (!messageId) {
    return {
      duplicate: true,
      conversation_id: identity.conversation_id,
      message_id: null,
      event_id: null,
      correlation_id: null,
    };
  }

  const { event, duplicate } = await bus.publish({
    event_type: 'client.message.received',
    source: 'test-simulate',
    client_id: identity.client_id,
    conversation_id: identity.conversation_id,
    payload: { conversation_id: identity.conversation_id, message_id: messageId, text: input.text, deliver: false },
    idempotency_key: `simmsg:${channel}:${externalId}`,
  });

  return {
    duplicate,
    conversation_id: identity.conversation_id,
    message_id: messageId,
    event_id: event.event_id,
    correlation_id: event.correlation_id,
  };
}

export function createSimulateHandler(deps: { pool: Pool; bus: EventBus; log: Logger }) {
  return async function handleSimulate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await new Promise<string>((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
        if (data.length > 64 * 1024) reject(new Error('payload grande demais'));
      });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
    const input = JSON.parse(body) as SimulateInput;
    if (!input.client_name || !input.text) {
      res.writeHead(422, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'client_name e text são obrigatórios' }));
      return;
    }
    const result = await simulateMessage(deps.pool, deps.bus, input);
    deps.log.info({ result }, 'mensagem de cliente simulada');
    res.writeHead(result.duplicate ? 200 : 202, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
  };
}

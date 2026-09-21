import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from 'pino';
import type { EventBus } from '../events/bus.js';

/**
 * Endpoint de TESTE (montado só fora de produção): simula uma mensagem de
 * cliente entrando — o caminho real de ingress do WhatsPlay é F1.4.
 *
 *   POST /test/simulate-message
 *   { client_name, contact_name?, channel?, address?, text, external_id? }
 *
 * Fluxo: garante org/cliente/contato → conversa (reutiliza a aberta ou cria)
 * → mensagem inbound → publica client.message.received (idempotente por
 * external_id) → o bus despacha para o handler da Luna (§7.1 módulo agent/).
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

const DEFAULT_ORG = { name: 'NEXO DIGITAL', slug: 'nexo' };

async function ensureOrganization(pool: Pool): Promise<string> {
  const existing = await pool.query<{ id: string }>(
    'SELECT id FROM organizations WHERE slug = $1',
    [DEFAULT_ORG.slug],
  );
  if (existing.rowCount) return existing.rows[0]!.id;
  const created = await pool.query<{ id: string }>(
    'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
    [DEFAULT_ORG.name, DEFAULT_ORG.slug],
  );
  return created.rows[0]!.id;
}

async function ensureClient(pool: Pool, orgId: string, clientName: string): Promise<string> {
  const code = clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const existing = await pool.query<{ id: string }>(
    'SELECT id FROM clients WHERE code = $1',
    [code],
  );
  if (existing.rowCount) return existing.rows[0]!.id;
  const created = await pool.query<{ id: string }>(
    'INSERT INTO clients (organization_id, name, code) VALUES ($1, $2, $3) RETURNING id',
    [orgId, clientName, code],
  );
  return created.rows[0]!.id;
}

async function ensureContact(
  pool: Pool,
  clientId: string,
  input: { contact_name?: string; channel: string; address: string },
): Promise<string> {
  const existing = await pool.query<{ id: string }>(
    'SELECT id FROM contacts WHERE client_id = $1 AND channel = $2 AND address = $3',
    [clientId, input.channel, input.address],
  );
  if (existing.rowCount) return existing.rows[0]!.id;
  const created = await pool.query<{ id: string }>(
    `INSERT INTO contacts (client_id, name, channel, address, is_primary)
     VALUES ($1, $2, $3, $4, true) RETURNING id`,
    [clientId, input.contact_name ?? null, input.channel, input.address],
  );
  return created.rows[0]!.id;
}

async function openConversation(
  pool: Pool,
  clientId: string,
  contactId: string,
  channel: string,
): Promise<string> {
  const open = await pool.query<{ id: string }>(
    `SELECT id FROM conversations
     WHERE contact_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [contactId],
  );
  if (open.rowCount) return open.rows[0]!.id;
  const created = await pool.query<{ id: string }>(
    `INSERT INTO conversations (client_id, contact_id, channel, state)
     VALUES ($1, $2, $3, 'NEW') RETURNING id`,
    [clientId, contactId, channel],
  );
  return created.rows[0]!.id;
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

  const orgId = await ensureOrganization(pool);
  const clientId = await ensureClient(pool, orgId, input.client_name);
  const contactId = await ensureContact(pool, clientId, {
    contact_name: input.contact_name,
    channel,
    address,
  });
  const conversationId = await openConversation(pool, clientId, contactId, channel);

  // Mensagem inbound — unique (channel, external_id) devolve duplicata.
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO messages (conversation_id, direction, channel, sender, body, external_id)
     VALUES ($1, 'inbound', $2, 'contact', $3, $4)
     ON CONFLICT (channel, external_id) WHERE external_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [conversationId, channel, input.text, externalId],
  );
  if (!inserted.rowCount) {
    return {
      duplicate: true,
      conversation_id: conversationId,
      message_id: null,
      event_id: null,
      correlation_id: null,
    };
  }
  const messageId = inserted.rows[0]!.id;

  const { event, duplicate } = await bus.publish({
    event_type: 'client.message.received',
    source: 'test-simulate',
    client_id: clientId,
    conversation_id: conversationId,
    payload: { conversation_id: conversationId, message_id: messageId, text: input.text },
    idempotency_key: `simmsg:${channel}:${externalId}`,
  });

  return {
    duplicate,
    conversation_id: conversationId,
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

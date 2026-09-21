import type { Pool } from 'pg';

/**
 * Ingress helpers — normalização de entidades para qualquer canal
 * (simulação de teste hoje, WhatsPlay na F1.4): garante org → cliente →
 * contato → conversa e insere a mensagem inbound de forma idempotente
 * (unique channel+external_id).
 */

export interface IngressIdentity {
  organization_id: string;
  client_id: string;
  contact_id: string;
  conversation_id: string;
}

const DEFAULT_ORG = { name: 'NEXO DIGITAL', slug: 'nexo' };

export async function ensureOrganization(pool: Pool, slug = DEFAULT_ORG.slug, name = DEFAULT_ORG.name): Promise<string> {
  const existing = await pool.query<{ id: string }>(
    'SELECT id FROM organizations WHERE slug = $1',
    [slug],
  );
  if (existing.rowCount) return existing.rows[0]!.id;
  const created = await pool.query<{ id: string }>(
    'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
    [name, slug],
  );
  return created.rows[0]!.id;
}

export async function ensureClient(pool: Pool, orgId: string, clientName: string): Promise<string> {
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

export async function ensureContact(
  pool: Pool,
  clientId: string,
  input: { contact_name?: string | null; channel: string; address: string },
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

/** Reutiliza a última conversa do contato (reabrindo via state machine) ou cria NEW. */
export async function openConversation(
  pool: Pool,
  clientId: string,
  contactId: string,
  channel: string,
): Promise<string> {
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM conversations
     WHERE contact_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [contactId],
  );
  if (existing.rowCount) return existing.rows[0]!.id;
  const created = await pool.query<{ id: string }>(
    `INSERT INTO conversations (client_id, contact_id, channel, state)
     VALUES ($1, $2, $3, 'NEW') RETURNING id`,
    [clientId, contactId, channel],
  );
  return created.rows[0]!.id;
}

/** Insere mensagem inbound idempotente. Retorna null se duplicada. */
export async function insertInboundMessage(
  pool: Pool,
  input: {
    conversation_id: string;
    channel: string;
    text: string;
    external_id: string;
    sender?: string;
    /** Quem falou (nome do membro/contato). NULL = autor desconhecido. */
    author_name?: string | null;
  },
): Promise<string | null> {
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO messages (conversation_id, direction, channel, sender, body, external_id, author_name)
     VALUES ($1, 'inbound', $2, $3, $4, $5, $6)
     ON CONFLICT (channel, external_id) WHERE external_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [input.conversation_id, input.channel, input.sender ?? 'contact', input.text, input.external_id, input.author_name ?? null],
  );
  return inserted.rowCount ? inserted.rows[0]!.id : null;
}

/** Resolve toda a cadeia de identidade de um contato de canal. */
export async function resolveIngressIdentity(
  pool: Pool,
  input: { client_name: string; contact_name?: string | null; channel: string; address: string },
): Promise<IngressIdentity> {
  const orgId = await ensureOrganization(pool);
  const clientId = await ensureClient(pool, orgId, input.client_name);
  const contactId = await ensureContact(pool, clientId, input);
  const conversationId = await openConversation(pool, clientId, contactId, input.channel);
  return { organization_id: orgId, client_id: clientId, contact_id: contactId, conversation_id: conversationId };
}

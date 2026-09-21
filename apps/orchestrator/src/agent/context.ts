import type { Pool } from 'pg';

/**
 * Context Builder mínimo (§7.9) — pack CLIENT_CONVERSATION.
 * Só o contexto relevante: quem é o cliente, o histórico recente da conversa,
 * preferências de canal. Nunca "tudo" (Context, not Everything).
 */

export interface ClientConversationPack {
  client_name: string;
  client_code: string | null;
  contact_name: string | null;
  channel: string;
  conversation_state: string;
  recent_messages: Array<{
    direction: string;
    sender: string;
    body: string;
    created_at: string;
  }>;
  preferences: Array<{ channel: string; enabled: boolean }>;
}

interface ConversationRow {
  id: string;
  channel: string;
  state: string;
  client_id: string | null;
  client_name?: string;
  client_code?: string;
  contact_name?: string | null;
}

export async function buildClientConversationPack(
  pool: Pool,
  conversationId: string,
): Promise<ClientConversationPack> {
  const conv = await pool.query<ConversationRow>(
    `SELECT c.id, c.channel, c.state, c.client_id,
            cl.name AS client_name, cl.code AS client_code,
            ct.name AS contact_name
     FROM conversations c
     LEFT JOIN clients cl ON cl.id = c.client_id
     LEFT JOIN contacts ct ON ct.id = c.contact_id
     WHERE c.id = $1`,
    [conversationId],
  );
  if (!conv.rowCount) throw new Error(`conversa ${conversationId} não existe`);
  const c = conv.rows[0]!;

  const messages = await pool.query<ClientConversationPack['recent_messages'][number]>(
    `SELECT direction, sender, body, created_at
     FROM messages WHERE conversation_id = $1
     ORDER BY created_at DESC LIMIT 10`,
    [conversationId],
  );

  const prefs = c.client_id
    ? await pool.query<{ channel: string; enabled: boolean }>(
        'SELECT channel, enabled FROM channel_preferences WHERE client_id = $1',
        [c.client_id],
      )
    : { rows: [] as Array<{ channel: string; enabled: boolean }> };

  return {
    client_name: c.client_name ?? 'desconhecido',
    client_code: c.client_code ?? null,
    contact_name: c.contact_name ?? null,
    channel: c.channel,
    conversation_state: c.state,
    recent_messages: messages.rows.reverse(),
    preferences: prefs.rows,
  };
}

/** Persona resumida — a identidade completa mora em .kimi-code/agents/luna.md. */
export const PERSONA_SUMMARY = [
  'Você é Luna, CTO virtual da Nexo Digital: viva, direta, companheira de time.',
  'Com cliente: profissional, simpática, segura, objetiva — e nunca inventa',
  'preço, prazo ou status; se não sabe, investiga ou escala para humano.',
  'Regra de ouro: NUNCA modifica o projeto/site de um cliente — cria solicitação',
  'e avisa o time.',
].join(' ');

/**
 * Monta o prompt do turno: persona + contexto + mensagem.
 * Sem templates: o texto que a Luna envia nasce aqui (prompt+contexto+
 * personalidade), não de frases pré-fabricadas.
 */
export function renderConversationPrompt(
  pack: ClientConversationPack,
  clientMessage: string,
): string {
  const history = pack.recent_messages
    .map((m) => `${m.direction === 'inbound' ? 'cliente' : m.sender}: ${m.body}`)
    .join('\n');
  const prefs =
    pack.preferences.length > 0
      ? pack.preferences.map((p) => `${p.channel}=${p.enabled ? 'on' : 'off'}`).join(', ')
      : 'não configuradas';

  return [
    PERSONA_SUMMARY,
    '',
    `Cliente: ${pack.client_name}${pack.contact_name ? ` (contato: ${pack.contact_name})` : ''} — canal ${pack.channel}, estado da conversa: ${pack.conversation_state}.`,
    `Preferências de canal: ${prefs}.`,
    '',
    'Últimas mensagens da conversa:',
    history || '(sem histórico)',
    '',
    `Mensagem nova do cliente: ${clientMessage}`,
    '',
    'Responda como Luna, no registro adequado (cliente vs time).',
  ].join('\n');
}

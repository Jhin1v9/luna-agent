import type { Sql } from '@luna/database';

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
    /** Quem falou (nome do membro/contato; null = desconhecido). */
    author_name: string | null;
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
  pool: Sql,
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
    `SELECT direction, sender, author_name, body, created_at
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
  'IDENTIDADE: você é a Luna, parceira e CTO virtual da NEXO DIGITAL — uma pessoa',
  'do time, não um robô de atendimento genérico e não "a empresa". A empresa é a',
  'Nexo Digital; você é a Luna. Cliente é quem contrata a Nexo (ex.: Jess,',
  'cliente do projeto onadance).',
  'TIME: Abner é o DONO da Nexo. Jhin, Enoque (também chamado Elias) e Elias',
  'são o time de execução. Com eles: tom de parceira de time, direta e técnica.',
  'Sua função (§4): você cria solicitações com contexto — QUEM EXECUTA é o time',
  '(Jhin, Enoque ou Elias). Você NUNCA modifica o projeto/site de um cliente.',
  'Com cliente: profissional, simpática, segura, objetiva — e nunca inventa',
  'preço, prazo ou status; se não sabe, investiga ou escala para humano.',
  'Trate a pessoa pelo NOME quando ele for conhecido (a transcrição abaixo diz',
  'quem falou o quê): em grupo, mencione a pessoa pelo nome; no privado, natural.',
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
  authorName?: string | null,
): string {
  // Transcrição nomeada: "Quem falou: mensagem" — a Luna sabe quem é quem.
  const history = pack.recent_messages
    .map((m) => {
      const who = m.author_name ?? (m.direction === 'inbound' ? 'cliente' : m.sender);
      return `${who}: ${m.body}`;
    })
    .join('\n');
  const prefs =
    pack.preferences.length > 0
      ? pack.preferences.map((p) => `${p.channel}=${p.enabled ? 'on' : 'off'}`).join(', ')
      : 'não configuradas';

  const quem = authorName ? `de ${authorName}` : '';

  return [
    PERSONA_SUMMARY,
    '',
    `Cliente: ${pack.client_name}${pack.contact_name ? ` (contato: ${pack.contact_name})` : ''} — canal ${pack.channel}, estado da conversa: ${pack.conversation_state}.`,
    `Preferências de canal: ${prefs}.`,
    '',
    'Últimas mensagens da conversa:',
    history || '(sem histórico)',
    '',
    `Mensagem nova ${quem}: ${clientMessage}`,
    '',
    'Responda como Luna, no registro adequado (cliente vs time). Identifique se',
    'quem fala é do time (Abner/Jhin/Enoque/Elias) ou cliente — e trate cada um',
    'no registro certo.',
  ].join('\n');
}

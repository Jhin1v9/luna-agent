import type { Pool } from 'pg';

/**
 * CONTEXT BUILDER (decreto owner 2026-09-24): quem liga/lê a Luna chega com
 * contexto — quem é a pessoa (segundo o cadastro/brain), o que ela pediu por
 * último, como foi a última conversa no WhatsApp. Usado por:
 *   - call.incoming → payload enriquecido pro Kimi Work (que decide e monta o
 *     contexto do Operador no ChatGPT);
 *   - voice.call outbound → pré-voo do Operador;
 *   - Kimi Work (agente no workspace) → roda via tools/kimiwork-context.mts.
 * Orquestrado pelo Kimi Work — aqui só a montagem factual dos fatos.
 */

export interface ContactFacts {
  id: string;
  name: string;
  address: string | null;
  role: string | null;
  clientName: string | null;
  extras: Record<string, unknown>;
}

export interface MessageFact {
  at: Date;
  direction: string;
  author: string | null;
  body: string;
  channel: string;
}

export interface ContactContext {
  contact: ContactFacts | null;
  recentMessages: MessageFact[];
  recentActivity: Array<{ at: Date; kind: string; summary: string }>;
}

/** Só dígitos — compara telefone independente de formatação. */
const digits = (s: string): string => s.replace(/[^0-9]/g, '');

/** Resolve contato por número de telefone (address) ou por nome. */
export async function resolveContactFacts(pool: Pool, by: { phone?: string; name?: string }): Promise<ContactFacts | null> {
  if (by.phone) {
    const d = digits(by.phone);
    if (d.length >= 6) {
      // Prefere a linha CANÔNICA (nome de verdade, não o jid cru) — o banco
      // tem rows cujo name é o próprio jid (ex.: "34685…@s.whatsapp.net")
      // vindas do sync; elas perdem pra contato com nome real.
      const r = await pool.query(
        `SELECT c.id, c.name, c.address, c.metadata, cl.name AS client_name
         FROM contacts c LEFT JOIN clients cl ON cl.id = c.client_id
         WHERE regexp_replace(c.address, '[^0-9]', '', 'g') LIKE $1
            OR regexp_replace(c.name, '[^0-9]', '', 'g') LIKE $1
         ORDER BY (CASE WHEN c.name LIKE '%@%' THEN 1 ELSE 0 END),
                  c.is_primary DESC NULLS LAST, c.updated_at DESC
         LIMIT 1`,
        [`%${d.slice(-9)}%`],
      );
      if (r.rowCount) return toFacts(r.rows[0]);
    }
  }
  if (by.name) {
    const r = await pool.query(
      `SELECT c.id, c.name, c.address, c.metadata, cl.name AS client_name
       FROM contacts c LEFT JOIN clients cl ON cl.id = c.client_id
       WHERE lower(c.name) = lower($1)
       ORDER BY c.is_primary DESC NULLS LAST, c.updated_at DESC
       LIMIT 1`,
      [by.name],
    );
    if (r.rowCount) return toFacts(r.rows[0]);
    // fallback: nome contém
    const r2 = await pool.query(
      `SELECT c.id, c.name, c.address, c.metadata, cl.name AS client_name
       FROM contacts c LEFT JOIN clients cl ON cl.id = c.client_id
       WHERE lower(c.name) LIKE '%' || lower($1) || '%'
       ORDER BY c.updated_at DESC LIMIT 1`,
      [by.name],
    );
    if (r2.rowCount) return toFacts(r2.rows[0]);
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toFacts(row: any): ContactFacts {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const rawName = String(row.name);
  // row cujo nome é o jid cru: usa o nome canônico apontado pelo alias
  const name = rawName.includes('@') && meta.alias_of ? String(meta.alias_of) : rawName;
  return {
    id: String(row.id),
    name,
    address: row.address ?? null,
    role: (meta.role as string) ?? null,
    clientName: row.client_name ?? null,
    extras: meta,
  };
}

/** Últimas mensagens trocadas com o contato (qualquer conversa dele). */
export async function recentMessagesWith(pool: Pool, contactId: string, limit = 10): Promise<MessageFact[]> {
  const r = await pool.query(
    `SELECT m.created_at, m.direction, m.author_name, m.body, m.channel
     FROM messages m
     JOIN conversations cv ON cv.id = m.conversation_id
     WHERE cv.contact_id = $1 AND m.body IS NOT NULL AND length(trim(m.body)) > 0
     ORDER BY m.created_at DESC LIMIT $2`,
    [contactId, limit],
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (r.rows as any[]).reverse().map((m) => ({
    at: m.created_at as Date,
    direction: String(m.direction),
    author: m.author_name ?? null,
    body: String(m.body).slice(0, 300),
    channel: String(m.channel),
  }));
}

/** Atividade recente: eventos que mencionam o contato (ligações, pedidos). */
export async function recentActivityFor(pool: Pool, contact: ContactFacts, limit = 8): Promise<ContactContext['recentActivity']> {
  const needle = digits(contact.address ?? '') || contact.name;
  const r = await pool.query(
    `SELECT occurred_at, event_type, payload FROM events
     WHERE payload::text ILIKE $1
     ORDER BY occurred_at DESC LIMIT $2`,
    [`%${needle.slice(-9) || contact.name}%`, limit],
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (r.rows as any[]).reverse().map((e) => ({
    at: e.occurred_at as Date,
    kind: String(e.event_type),
    summary: summarizeEvent(String(e.event_type), e.payload as Record<string, unknown>),
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summarizeEvent(eventType: string, payload: any): string {
  const p = payload?.payload ?? payload ?? {};
  if (eventType === 'voice.call.requested') {
    const b = p.brief ?? p;
    return `ligação pedida → ${b.destinatario ?? '?'} (autorizador: ${b.autorizador ?? '?'}) — ${String(b.motivo ?? '').slice(0, 90)}`;
  }
  if (eventType === 'whatsapp.message.received') return `mensagem no WhatsApp: ${String(p.text ?? '').slice(0, 90)}`;
  return `${eventType}`;
}

/** Monta o contexto completo de um contato. */
export async function buildContactContext(pool: Pool, by: { phone?: string; name?: string }): Promise<ContactContext> {
  const contact = await resolveContactFacts(pool, by);
  if (!contact) return { contact: null, recentMessages: [], recentActivity: [] };
  const [recentMessages, recentActivity] = await Promise.all([
    recentMessagesWith(pool, contact.id),
    recentActivityFor(pool, contact),
  ]);
  return { contact, recentMessages, recentActivity };
}

/** Bloco de texto PT-BR pronto pra injetar no prompt do Operador (ChatGPT). */
export function formatContactContextText(ctx: ContactContext): string {
  const lines: string[] = [];
  if (!ctx.contact) {
    lines.push('CONTEXTO DO CONTATO: desconhecido (não achei no cadastro). Tratar com perguntas diretas.');
    return lines.join('\n');
  }
  const c = ctx.contact;
  lines.push(`QUEM ESTÁ NA LINHA: ${c.name}`);
  if (c.address) lines.push(`- telefone: ${c.address}`);
  if (c.role) lines.push(`- papel: ${c.role}`);
  if (c.clientName) lines.push(`- cliente/relação: ${c.clientName}`);
  if (c.extras && Object.keys(c.extras).length) {
    const extras = Object.entries(c.extras)
      .filter(([k]) => !['role'].includes(k))
      .slice(0, 6)
      .map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`)
      .join(' | ');
    if (extras) lines.push(`- cadastro: ${extras}`);
  }
  if (ctx.recentMessages.length) {
    lines.push('', 'ÚLTIMA CONVERSA NO WHATSAPP (mais recente por último):');
    for (const m of ctx.recentMessages) {
      const hh = m.at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const quem = m.direction === 'inbound' ? (m.author ?? 'contato') : 'Luna';
      lines.push(`[${hh}] ${quem}: ${m.body.replace(/\s+/g, ' ').slice(0, 140)}`);
    }
  }
  if (ctx.recentActivity.length) {
    lines.push('', 'HISTÓRICO RECENTE:');
    for (const a of ctx.recentActivity) {
      const dd = a.at.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      lines.push(`- [${dd}] ${a.summary}`);
    }
  }
  return lines.join('\n');
}

import type { Pool } from 'pg';
import { alertOwnerWhatsApp, registryCheck, registryUpsert, resolveIngressIdentity } from '@luna/database';

export interface UnknownContactMessage {
  chat_id: string;
  chat_name: string;
  text: string;
  external_id: string;
  author_name?: string | null;
}

export async function requestContactApproval(pool: Pool, msg: UnknownContactMessage): Promise<{ id: string; created: boolean }> {
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO contact_approval_requests (chat_key, chat_name, context_text, source_payload)
     VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING RETURNING id::text`,
    [msg.chat_id, msg.chat_name, msg.text.slice(0, 2000), JSON.stringify(msg)],
  );
  const row = inserted.rows[0] ?? (await pool.query<{ id: string }>(
    `SELECT id::text FROM contact_approval_requests WHERE chat_key=$1 AND status='pending' ORDER BY id DESC LIMIT 1`, [msg.chat_id],
  )).rows[0];
  if (!row) throw new Error('não foi possível criar solicitação de contato');
  if (inserted.rowCount) {
    const summary = msg.text.replace(/\s+/g, ' ').trim().slice(0, 500);
    await alertOwnerWhatsApp(pool,
      `🔐 Solicitação de contato #${row.id}\n\nContato: ${msg.chat_name}\nDisse: “${summary || '(mensagem sem texto)'}”\n\nPosso autorizar este contato?\nResponda: sim ${row.id} ou não ${row.id}`,
      { escalation_id: `contact-approval-${row.id}`, priority: 'approval', stage: 'contact_approval' },
    );
  }
  return { id: row.id, created: Boolean(inserted.rowCount) };
}

async function queueMessage(pool: Pool, chatKey: string, chatName: string, body: string, meta: Record<string, unknown>): Promise<void> {
  const identity = await resolveIngressIdentity(pool, { client_name: chatName, contact_name: chatName, channel: 'whatsapp', address: chatKey });
  const out = await pool.query<{ id: string }>(
    `INSERT INTO messages (conversation_id,direction,channel,sender,author_name,body,metadata,send_state)
     VALUES ($1,'outbound','whatsapp','luna','Luna',$2,$3::jsonb,'queued') RETURNING id`,
    [identity.conversation_id, body, JSON.stringify(meta)],
  );
  await pool.query('SELECT pg_notify($1,$2)', ['luna_outbound', out.rows[0]!.id]);
}

export async function handleContactApprovalCommand(pool: Pool, sender: string, text: string): Promise<boolean> {
  const match = text.trim().match(/^(sim|não|nao)\s+(\d+)\s*[.!]?$/i);
  if (!match) return false;
  const authority = await registryCheck(pool, sender, 'aprovar contato');
  if (!authority.ok || authority.entry.role !== 'owner') return false;
  const id = match[2]!;
  const req = (await pool.query<{ id: string; chat_key: string; chat_name: string; status: string }>(
    'SELECT id::text,chat_key,chat_name,status FROM contact_approval_requests WHERE id=$1::bigint FOR UPDATE', [id],
  )).rows[0];
  if (!req || req.status !== 'pending') {
    await queueMessage(pool, authority.entry.chatKey, authority.entry.canonicalName, `A solicitação #${id} não existe ou já foi decidida.`, { kind: 'contact_approval_result', request_id: id });
    return true;
  }
  const approved = match[1]!.toLowerCase() === 'sim';
  await pool.query(`UPDATE contact_approval_requests SET status=$2,decided_by=$3,decided_at=now(),updated_at=now() WHERE id=$1::bigint`, [id, approved ? 'approved' : 'denied', authority.entry.canonicalName]);
  if (!approved) {
    await queueMessage(pool, authority.entry.chatKey, authority.entry.canonicalName, `Solicitação #${id} negada. O contato ${req.chat_name} continua bloqueado.`, { kind: 'contact_approval_result', request_id: id });
    return true;
  }
  await registryUpsert(pool, { chatKey: req.chat_key, kind: 'individual', canonicalName: req.chat_name, displayHint: req.chat_name, role: 'allowed', notifyChannel: null, phoneE164: null, resolvedBy: authority.entry.canonicalName, note: `Autorização temporária pela solicitação #${id}; aguardando nome e telefone.` });
  await queueMessage(pool, req.chat_key, req.chat_name, 'Olá! Aqui é a Luna, assistente da Superclim. Seu contato foi autorizado para atendimento. Para eu concluir seu cadastro, qual é o seu nome e seu número de telefone com DDI?', { kind: 'contact_onboarding', request_id: id });
  await queueMessage(pool, authority.entry.chatKey, authority.entry.canonicalName, `Solicitação #${id} aprovada. Já pedi ao contato ${req.chat_name} o nome e o telefone para concluir o cadastro.`, { kind: 'contact_approval_result', request_id: id });
  return true;
}

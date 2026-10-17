import type { Pool } from 'pg';
import { alertOwnerWhatsApp, registryCheck, registryUpsert, resolveIngressIdentity } from '@luna/database';

export interface UnknownContactMessage {
  chat_id: string;
  chat_name: string;
  text: string;
  external_id: string;
  author_name?: string | null;
  /** Sinal do transporte (badge.is_group). Falso-negativo possível no DOM —
   *  o heuristico de autores em looksLikeGroupContext cobre o resto. */
  is_group?: boolean;
}

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Contexto com 2+ autores distintos no formato "Autor: texto" (um por linha)
 * é grupo com alta confiança — grupos nunca passam pelo fluxo de aprovação.
 * Cobre o falso-negativo do DOM (incidente 15/10: grupo gerou solicitação #8).
 */
export function looksLikeGroupContext(text: string): boolean {
  const authors = new Set<string>();
  for (const line of text.split('\n')) {
    const m = line.match(/^([^:]{2,40}):\s+\S/);
    if (m && !/^(t[uú]|voc[eê]|you|eu)$/i.test(m[1]!.trim())) authors.add(norm(m[1]!));
  }
  return authors.size >= 2;
}

const TIPS =
  '\n\n💡 Você pode responder:\n' +
  '• sim 3 → autoriza só a #3\n' +
  '• sim 3 5 8 → autoriza várias de uma vez\n' +
  '• sim abner → autoriza pelo nome do contato\n' +
  '• sim todos → autoriza todas as pendentes\n' +
  '• não 3 → nega (quem foi negado pode ser aprovado depois, e vice-versa)\n' +
  '• pendentes → lista as solicitações pendentes';

export async function requestContactApproval(pool: Pool, msg: UnknownContactMessage): Promise<{ id: string; created: boolean }> {
  const group = msg.is_group === true || looksLikeGroupContext(msg.text);
  if (group) {
    // Grupo recusado é recusado UMA vez (decreto owner 15/10): mensagem nova
    // no grupo NÃO gera nova solicitação nem novo alerta de correção.
    const jaRecusado = await pool.query<{ id: string }>(
      `SELECT id::text FROM contact_approval_requests
       WHERE chat_key=$1 AND status='denied' AND decided_by='system'
       ORDER BY id DESC LIMIT 1`, [msg.chat_id],
    );
    if (jaRecusado.rows[0]) return { id: jaRecusado.rows[0]!.id, created: false };
  }
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO contact_approval_requests (chat_key, chat_name, context_text, source_payload, status, decided_by, decided_at)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id::text`,
    [
      msg.chat_id,
      msg.chat_name,
      msg.text.slice(0, 2000),
      JSON.stringify({ ...msg, is_group: group }),
      group ? 'denied' : 'pending',
      group ? 'system' : null,
      group ? new Date() : null,
    ],
  );
  const row = inserted.rows[0] ?? (await pool.query<{ id: string }>(
    `SELECT id::text FROM contact_approval_requests WHERE chat_key=$1 AND status='pending' ORDER BY id DESC LIMIT 1`, [msg.chat_id],
  )).rows[0];
  if (!row) throw new Error('não foi possível criar solicitação de contato');
  if (inserted.rowCount) {
    const summary = msg.text.replace(/\s+/g, ' ').trim().slice(0, 500);
    if (group) {
      await alertOwnerWhatsApp(pool,
        `⚠️ Correção da solicitação #${row.id}: o chat "${msg.chat_name}" é um GRUPO e foi bloqueado automaticamente. Grupos nunca podem ser autorizados por esse fluxo. Nada a decidir.`,
        { escalation_id: `contact-approval-${row.id}-correction`, priority: 'approval', stage: 'contact_approval_correction' });
    } else {
      await alertOwnerWhatsApp(pool,
        `🔐 Solicitação de contato #${row.id}\n\nContato: ${msg.chat_name}\nDisse: “${summary || '(mensagem sem texto)'}”\n\nPosso autorizar este contato?${TIPS}`,
        { escalation_id: `contact-approval-${row.id}`, priority: 'approval', stage: 'contact_approval' });
    }
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

export type ApprovalCommand =
  | { verb: 'sim' | 'não'; kind: 'all' }
  | { verb: 'sim' | 'não'; kind: 'ids'; ids: number[] }
  | { verb: 'sim' | 'não'; kind: 'name'; term: string };

/**
 * Parser dos comandos de decisão do owner:
 *   sim 3 · não 8 · sim 2 3 8 · sim abner · sim todos
 * `não todos` é propositalmente inválido — negar todas sem querer é footgun.
 */
export function parseApprovalCommand(text: string): ApprovalCommand | null {
  const m = text.trim().match(/^(sim|não|nao)\s+(.+?)\s*[.!?]?$/i);
  if (!m) return null;
  const verb = m[1]!.toLowerCase() === 'sim' ? 'sim' : 'não';
  const rest = m[2]!.trim();
  if (/^(todos|todas|tudo|todos os pendentes|todas as pendentes)$/i.test(rest)) {
    return verb === 'sim' ? { verb, kind: 'all' } : null;
  }
  if (/^[\d\s,.;!]+$/.test(rest)) {
    const ids = rest.match(/\d+/g)?.map(Number) ?? [];
    if (ids.length > 0) return { verb, kind: 'ids', ids };
  }
  return { verb, kind: 'name', term: rest };
}

export async function handleContactApprovalCommand(pool: Pool, sender: string, text: string): Promise<boolean> {
  const cmd = parseApprovalCommand(text);
  if (!cmd) return false;
  const authority = await registryCheck(pool, sender, 'aprovar contato');
  if (!authority.ok || authority.entry.role !== 'owner') return false;

  let targetIds: number[] = [];
  if (cmd.kind === 'all') {
    const pend = await pool.query<{ id: string }>(
      `SELECT id::text FROM contact_approval_requests WHERE status='pending' ORDER BY id`, []);
    targetIds = pend.rows.map((r) => Number(r.id));
    if (targetIds.length === 0) {
      await queueMessage(pool, authority.entry.chatKey, authority.entry.canonicalName,
        'Nenhuma solicitação de contato pendente no momento.', { kind: 'contact_approval_result' });
      return true;
    }
  } else if (cmd.kind === 'ids') {
    targetIds = [...new Set(cmd.ids)];
  } else {
    const term = norm(cmd.term);
    const pend = await pool.query<{ id: string; chat_name: string }>(
      `SELECT id::text, chat_name FROM contact_approval_requests WHERE status='pending'`, []);
    const matched = pend.rows.filter((r) => norm(r.chat_name).includes(term));
    if (matched.length === 0) {
      // Nome não bate com nenhuma pendência: não era um comando de aprovação
      // (ex.: owner respondeu "sim amanhã de manhã") — devolve pro fluxo normal.
      return false;
    }
    targetIds = matched.map((r) => Number(r.id));
  }

  const approvedList: string[] = [];
  const deniedList: string[] = [];
  const skippedList: string[] = [];
  for (const id of targetIds) {
    const req = (await pool.query<{ id: string; chat_key: string; chat_name: string; status: string; is_group: string | null }>(
      `SELECT id::text, chat_key, chat_name, status, source_payload->>'is_group' AS is_group
       FROM contact_approval_requests WHERE id=$1::bigint FOR UPDATE`, [id],
    )).rows[0];
    if (!req) { skippedList.push(`#${id} (inexistente)`); continue; }
    const groupRow = req.is_group === 'true';
    // RE-DECISÃO (owner 15/10): negada pode ser aprovada depois e aprovada
    // pode ser revogada — exceto GRUPO, que nunca é autorizável (decreto).
    if (groupRow) { skippedList.push(`#${id} (${req.chat_name}, GRUPO — nunca autorizável)`); continue; }
    if (req.status === 'denied' && cmd.verb === 'não') { skippedList.push(`#${id} (${req.chat_name}, já negada)`); continue; }
    if (req.status === 'approved' && cmd.verb === 'sim') { skippedList.push(`#${id} (${req.chat_name}, já aprovada)`); continue; }
    const approved = cmd.verb === 'sim';
    await pool.query(
      `UPDATE contact_approval_requests SET status=$2,decided_by=$3,decided_at=now(),updated_at=now() WHERE id=$1::bigint`,
      [id, approved ? 'approved' : 'denied', authority.entry.canonicalName]);
    if (!approved) {
      if (req.status === 'approved') {
        // REVOGAÇÃO: some do registry → volta a ser desconhecido; a próxima
        // mensagem do contato reabre solicitação (fluxo normal de aprovação).
        await pool.query(
          `DELETE FROM chat_registry WHERE chat_key=$1 AND kind='individual' AND role='allowed'`, [req.chat_key]);
      }
      deniedList.push(`#${id} ${req.chat_name}${req.status === 'approved' ? ' (revogada — voltou pra fila de desconhecidos)' : ''}`);
      continue;
    }
    await registryUpsert(pool, {
      chatKey: req.chat_key, kind: 'individual', canonicalName: req.chat_name, displayHint: req.chat_name,
      role: 'allowed', notifyChannel: null, phoneE164: null, resolvedBy: authority.entry.canonicalName,
      note: `Autorização pela solicitação #${id}${cmd.kind !== 'ids' || targetIds.length > 1 ? ' (decisão em lote)' : ''}; aguardando nome e telefone.`,
    });
    await queueMessage(pool, req.chat_key, req.chat_name,
      'Olá! Aqui é a Luna, assistente da Superclim. Seu contato foi autorizado para atendimento. Para eu concluir seu cadastro, qual é o seu nome e seu número de telefone com DDI?',
      { kind: 'contact_onboarding', request_id: id });
    approvedList.push(`#${id} ${req.chat_name}`);
  }

  const parts: string[] = [];
  if (approvedList.length) parts.push(`✅ Aprovadas: ${approvedList.join(' · ')}${approvedList.length === 1 ? ' — já pedi nome e telefone pro cadastro.' : ' — já pedi nome e telefone de cada um.'}`);
  if (deniedList.length) parts.push(`⛔ Negadas: ${deniedList.join(' · ')}`);
  if (skippedList.length) parts.push(`⚠️ Puladas: ${skippedList.join(' · ')}`);
  await queueMessage(pool, authority.entry.chatKey, authority.entry.canonicalName,
    `Resumo da decisão (${cmd.verb}${cmd.kind === 'all' ? ' todos' : cmd.kind === 'name' ? ` ${cmd.term}` : ` ${targetIds.join(' ')}`}):\n${parts.join('\n')}`,
    { kind: 'contact_approval_result', batch: targetIds.length > 1 });
  return true;
}

/**
 * "pendentes" (ou variação) — owner pergunta quais solicitações estão
 * aguardando decisão. As pendências ficam salvas no Postgres até serem
 * decididas; contato que manda mais msg NÃO gera alerta novo (uma vez já era).
 */
export async function handlePendingListCommand(pool: Pool, sender: string, text: string): Promise<boolean> {
  if (!/^(pendentes|pendencia|solicita[cç][oõ]es pendentes|contatos pendentes|lista pendentes|listar pendentes|quais pendentes)[.!]?$/i.test(text.trim())) {
    return false;
  }
  const authority = await registryCheck(pool, sender, 'listar pendências');
  if (!authority.ok || authority.entry.role !== 'owner') return false;
  const pend = await pool.query<{ id: string; chat_name: string }>(
    `SELECT id::text, chat_name FROM contact_approval_requests WHERE status='pending' ORDER BY id`, []);
  if (pend.rows.length === 0) {
    await queueMessage(pool, authority.entry.chatKey, authority.entry.canonicalName,
      'Nenhuma solicitação de contato pendente. ✅', { kind: 'contact_approval_result' });
    return true;
  }
  const lines = pend.rows.map((r) => `• #${r.id} ${r.chat_name}`);
  await queueMessage(pool, authority.entry.chatKey, authority.entry.canonicalName,
    `🔐 Solicitações pendentes (${pend.rows.length}):\n${lines.join('\n')}\n${TIPS}`,
    { kind: 'contact_approval_result' });
  return true;
}

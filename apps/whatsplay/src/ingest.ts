import type { Pool } from 'pg';
import { resolveIngressIdentity, insertInboundMessage, publishEvent, recordAudit, insertKimiWorkEvent } from '@luna/database';
import type { Logger } from 'pino';
import type { UnreadMessage, WhatsAppTransport } from './transport.js';
import { detectSelfEcho } from './self-echo.js';

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
    const identity = await resolveIngressIdentity(pool, {
      client_name: msg.chat_name,
      contact_name: msg.chat_name,
      channel: 'whatsapp',
      address: msg.chat_id,
    });

    // 🆕 CITAÇÃO (owner 26/09): detectar de verdade se a mensagem citada é
    // NOSSA. O transporte não sabe (hardcoded false) — casamos o texto citado
    // contra as últimas mensagens outbound da Luna nesta conversa. Sem isso,
    // responder a msg da Luna com um emoji chegava como "chat inteiro" e o
    // reply/cita (regra de grupo §5) nunca disparava.
    let quotedFromLuna = msg.quoted_from_luna ?? false;
    if (!quotedFromLuna && msg.quoted_text) {
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
      const q = norm(msg.quoted_text);
      const probe = q.slice(0, 60);
      const tail = q.slice(-60);
      const recent = await pool.query<{ body: string }>(
        `SELECT body FROM messages
         WHERE conversation_id = $1 AND direction = 'outbound' AND channel = 'whatsapp'
         ORDER BY created_at DESC LIMIT 20`,
        [identity.conversation_id],
      );
      quotedFromLuna = recent.rows.some((r) => {
        const b = norm(r.body ?? '');
        return b.length > 0 && (b.includes(probe) || (tail.length >= 20 && b.includes(tail)));
      });
    }

    // 🆕 ECO PRÓPRIO (owner 27/09): relay/citação devolve as falas da Luna
    // como mensagem nova e ela comentava o próprio eco — skip com audit.
    if (msg.text) {
      const recent = await pool.query<{ body: string }>(
        `SELECT body FROM messages
         WHERE conversation_id = $1 AND direction = 'outbound' AND channel = 'whatsapp'
         ORDER BY created_at DESC LIMIT 10`,
        [identity.conversation_id],
      );
      const echo = detectSelfEcho(msg.text, quotedFromLuna, recent.rows.map((r) => r.body));
      if (echo.echo) {
        log.info({ chat: msg.chat_name, overlap: echo.overlap }, 'eco próprio detectado (relay/citação das falas da Luna) — skip sem resposta');
        await recordAudit(pool, {
          actor: 'whatsplay',
          action: 'whatsapp.message.self_echo_skipped',
          tool: 'whatsplay_ingest',
          client_id: identity.client_id,
          result: 'success',
          metadata: { external_id: msg.external_id, overlap: echo.overlap, relay_signature: echo.relaySignature },
        });
        return 'skipped';
      }
    }

    // 2026-10-14 (decreto owner "braços potentes"): grupo sem menção NÃO é
    // mais engolido aqui — o evento sobe pro FAST e é O MODELO que decide
    // entre ANSWER e SILENCE (saída estruturada nova). Antes: skip duro §5.
    const effectiveText = msg.text || (msg.image_path ? '[imagem]' : '');

    // 📇 Diretório de pessoas (decreto owner 01/10): junto com cada mensagem a
    // Luna recebe nome + número + papel + org do autor (ex.: "Abner 34685...
    // CEO NEXO", "Matheus — HDM INDUSTRIAL - CLIENTE"), pra classificar quem
    // fala o quê sem chute. Fonte: contacts.metadata (phone/role/org), seed
    // manual; sem cadastro, os campos vêm null e nada quebra.
    const authorName = msg.author_name ?? msg.chat_name;
    let authorPhone: string | null = null;
    let authorRole: string | null = null;
    let authorOrg: string | null = null;
    const dir = await pool.query<{ phone: string | null; role: string | null; org: string | null }>(
      `SELECT metadata->>'phone' AS phone, metadata->>'role' AS role, metadata->>'org' AS org
       FROM contacts WHERE name = $1 AND metadata->>'role' IS NOT NULL
       ORDER BY updated_at DESC LIMIT 1`,
      [authorName],
    );
    if (dir.rowCount) {
      authorPhone = dir.rows[0]!.phone;
      authorRole = dir.rows[0]!.role;
      authorOrg = dir.rows[0]!.org;
    }

    const messageId = await insertInboundMessage(pool, {
      conversation_id: identity.conversation_id,
      channel: 'whatsapp',
      text: effectiveText,
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
        mentioned_luna: msg.mentioned_luna === true,
        deliver: true,
        chat_id: msg.chat_id,
        quoted_text: msg.quoted_text ?? null,
        quoted_author: msg.quoted_author ?? null,
        quoted_from_luna: quotedFromLuna,
        image_path: msg.image_path ?? null,
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

    // PONTE KIMI WORK (decreto owner 2026-09-24): a menção/resposta direta
    // cai na caixa de entrada do cérebro Kimi Work — é ELE quem decide e
    // age (pelo messages+luna_outbound), não um fluxo hardcoded. Idempotente.
    await insertKimiWorkEvent(pool, {
      kind: 'whatsapp.message',
      payload: {
        conversation_id: identity.conversation_id,
        message_id: messageId,
        chat_id: msg.chat_id,
        chat_name: msg.chat_name,
        author_name: msg.author_name ?? msg.chat_name,
        text: msg.text,
        is_group: msg.is_group,
        mentioned_luna: msg.mentioned_luna,
        quoted_from_luna: quotedFromLuna,
        quoted_text: msg.quoted_text ?? null,
        quoted_author: msg.quoted_author ?? null,
        image_path: msg.image_path ?? null,
        correlation_id: event.correlation_id,
        author_phone: authorPhone,
        author_role: authorRole,
        author_org: authorOrg,
      },
      idempotencyKey: `kimiwork:wa:msg:${msg.external_id}`,
    }).catch((err) => log.warn({ err: String(err).slice(0, 120) }, 'kimiwork inbox: falha ao enfileirar (não bloqueia o ingest)'));

    log.info({ correlation_id: event.correlation_id, chat: msg.chat_name }, 'mensagem ingerida');
    return 'published';
  }

  return { ingestOne };
}

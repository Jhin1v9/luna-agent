import type { Pool, PoolClient } from 'pg';
import type { Logger } from 'pino';
import type { KimiLiveAdapter } from '@luna/agent';
import { extractAnswerEnvelopeText } from '@luna/shared';
import { sendTeamMessage, type TelegramConfig } from '@luna/channels';
import { recordAudit } from '@luna/database';
import type { WhatsAppTransport } from './transport.js';
import { matchesAllowlist, parseAllowlist } from './allowlist.js';
import { withAutoRepair, type RepairableTransport } from './auto-repair.js';
import { sanitizeOutboundText } from './outbound-text.js';

/**
 * Fila de saída (zero polling): o handler da Luna grava a resposta com
 * send_state='queued' e dispara pg_notify('luna_outbound', message_id).
 * Aqui o WhatsPlay escuta (LISTEN), envia pela transport e marca 'sent'.
 */

export interface OutboundDeps {
  pool: Pool;
  transport: WhatsAppTransport;
  log: Logger;
  /** Anti-ban (ADR-004): espera humana (com jitter) antes de enviar. Default 6s. */
  humanDelayMs?: number;
  /** GUARDRAIL DE CÓDIGO (decreto do owner, ADR-020): fora de produção, só
   * estes destinatários (nome ou jid) podem receber mensagem da Luna.
   * Lista vazia com enforce=true = recusa TUDO (fail-closed). Nunca
   * silencioso: recusa gera audit explícito + send_state='failed'. */
  allowlist?: string[];
  enforceAllowlist?: boolean;
  /** Auto-reparo visual (§14): brain p/ análise + Telegram p/ alerta. */
  adapter?: KimiLiveAdapter;
  telegram?: TelegramConfig;
}

interface OutboundMessageRow {
  id: string;
  body: string;
  conversation_id: string;
  address: string | null;
  contact_name: string | null;
  conversation_chat_id: string | null;
  correlation_id: string | null;
  /** 🆕 CITAÇÃO (mention.respond v2): trecho da mensagem a citar — quando
   *  presente, a entrega usa replyToMessage (citação visual) em vez de
   *  sendMessage comum. Falha da citação NUNCA degrada pra envio órfão. */
  reply_to_query: string | null;
}

/** BUG 1 (P1, incidente 2026-09-24): dois envios concorrentes digitavam no
 * MESMO campo de composição e os caracteres se intercalavam ("msg esquisita").
 * Há UM page por perfil — então há UMA fila FIFO global: um envio por vez,
 * na ordem de chegada (a espera humana fica FORA da trava; a trava cobre
 * limpar+digitar+enviar dentro da transport). */
let sendChain: Promise<unknown> = Promise.resolve();
function withSendLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = sendChain.then(fn, fn); // segue a fila mesmo se o anterior falhou
  sendChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function createOutboundListener(deps: OutboundDeps) {
  const { pool, transport, log } = deps;
  const allowlist = parseAllowlist(deps.allowlist?.join(','));
  const enforce = deps.enforceAllowlist ?? false;

  /** GUARDRAIL: fora de produção, destino precisa estar na allowlist. */
  function refusedByAllowlist(target: string): string | null {
    if (!enforce) return null;
    if (matchesAllowlist(allowlist, target)) return null;
    return allowlist.length === 0
      ? 'allowlist vazia em modo teste/dev — envio recusado (fail-closed, decreto do owner)'
      : `destinatário fora da allowlist de teste [${allowlist.join(', ')}]`;
  }

  /** Exceção de NOTIFICAÇÕES A CLIENTES (decreto owner 2026-09-25): envio
   *  marcado como notify_send com destino ALLOWED no Chat Registry (telefone
   *  que o próprio cliente colocou no perfil do workspace) passa pela
   *  allowlist de dev — é canal de notificação, não conversa de teste. */
  async function notifySendExempt(messageId: string, target: string): Promise<boolean> {
    const flagged = await pool.query<{ is_notify: string | null }>(
      `SELECT metadata->>'notify_send' AS is_notify FROM messages WHERE id = $1`,
      [messageId],
    );
    if (flagged.rows[0]?.is_notify !== '1') return false;
    const { registryCheck } = await import('@luna/database');
    const decision = await registryCheck(pool, target.replace(/^whatsapp:/, ''), 'notificar');
    if (!decision.ok) {
      log.warn({ message_id: messageId, target, reason: decision.reason }, 'notify_send: destino não permitido pelo registry');
      return false;
    }
    return true;
  }

  /**
   * SEND-SAFETY (decreto owner, pós-incidente 2026-09-21): a resposta tem que
   * ir SEMPRE pro mesmo chat de onde veio a pergunta. Antes de entregar,
   * verifica se a conversa da mensagem outbound == conversa de origem do
   * evento que a gerou (reply_to_event → events.payload.conversation_id).
   *   mismatch PROVADO → bloqueio INCONDICIONAL + alerta imediato pro owner
   *   no Telegram ("tentei responder no chat errado") + audit.
   *   evento de origem ausente → segue com nota de auditoria (sem evidência
   *   de mismatch não se bloqueia; com evidência, nunca se envia).
   */
  async function sendSafetyCheck(messageId: string, conversationId: string): Promise<void> {
    const msg = await pool.query<{ reply_to_event: string | null }>(
      `SELECT metadata->>'reply_to_event' AS reply_to_event FROM messages WHERE id = $1`,
      [messageId],
    );
    const replyTo = msg.rows[0]?.reply_to_event;
    if (!replyTo) {
      // P2 (auditoria do incidente 2026-09-24): envio manual bypassava TODA
      // verificação de destino. A BLOCKLIST do Chat Registry vale SEMPRE
      // (deny-first) — mesmo sem reply_to_event. Alvo fora do registry segue
      // (clientes não registrados), mas BLOCKED para na hora.
      const alvoRow = await pool.query<{ address: string | null; name: string | null }>(
        `SELECT ct.address, ct.name FROM conversations cv LEFT JOIN contacts ct ON ct.id = cv.contact_id WHERE cv.id = $1`,
        [conversationId],
      );
      const alvoNome = alvoRow.rows[0]?.address ?? alvoRow.rows[0]?.name;
      if (alvoNome) {
        const { registryCheck } = await import('@luna/database');
        const decision = await registryCheck(pool, alvoNome, 'mandar mensagem');
        if (!decision.ok && /BLOCKED/i.test(decision.reason)) {
          await mark(messageId, 'failed', `BLOCKLIST: ${decision.reason}`);
          await recordAudit(pool, {
            actor: 'whatsplay', action: 'send_safety.blocked', tool: 'send_safety',
            result: 'failed', metadata: { message_id: messageId, alvo: alvoNome, motivo: 'registry_blocked', detail: decision.reason },
          });
          const alerta =
            `🚨 BLOCKLIST: envio manual para '${alvoNome}' BLOQUEADO pelo Chat Registry.\n` +
            `Nada foi enviado. — Luna`;
          if (deps.telegram?.botToken && deps.telegram.teamChatId) {
            try { await sendTeamMessage(alerta, deps.telegram); } catch (err) { log.error({ err }, 'blocklist: alerta Telegram falhou'); }
          } else {
            log.error({ alerta }, 'blocklist: TELEGRAM não configurado — alerta NÃO enviado');
          }
          log.error({ message_id: messageId, alvo: alvoNome }, 'BLOCKLIST: envio manual bloqueado (registry deny-first)');
          throw new Error('send_safety_blocked');
        }
      }
      await recordAudit(pool, {
        actor: 'whatsplay', action: 'send_safety.skipped', tool: 'send_safety',
        result: 'success', metadata: { message_id: messageId, motivo: 'sem reply_to_event (envio manual)' },
      });
      return;
    }
    const origin = await pool.query<{ origin_conv: string | null }>(
      `SELECT payload->'payload'->>'conversation_id' AS origin_conv FROM events WHERE event_id = $1`,
      [replyTo],
    );
    const originConv = origin.rows[0]?.origin_conv;
    if (!originConv) {
      await recordAudit(pool, {
        actor: 'whatsplay', action: 'send_safety.skipped', tool: 'send_safety',
        result: 'success', metadata: { message_id: messageId, motivo: 'evento de origem não encontrado' },
      });
      return;
    }
    if (originConv === conversationId) return; // vínculo íntegro

    const alvo = await pool.query<{ address: string | null }>(
      `SELECT ct.address FROM conversations cv LEFT JOIN contacts ct ON ct.id = cv.contact_id WHERE cv.id = $1`,
      [conversationId],
    );
    const origem = await pool.query<{ address: string | null }>(
      `SELECT ct.address FROM conversations cv LEFT JOIN contacts ct ON ct.id = cv.contact_id WHERE cv.id = $1`,
      [originConv],
    );
    const destinoAlvo = alvo.rows[0]?.address ?? conversationId;
    const destinoOrigem = origem.rows[0]?.address ?? originConv;

    await mark(messageId, 'failed', `SEND-SAFETY: resposta ia para '${destinoAlvo}' mas a pergunta veio de '${destinoOrigem}' — bloqueado`);
    await recordAudit(pool, {
      actor: 'whatsplay', action: 'send_safety.blocked', tool: 'send_safety',
      result: 'failed',
      metadata: { message_id: messageId, ia_para: destinoAlvo, pergunta_veio_de: destinoOrigem, evento_origem: replyTo },
    });
    const alerta =
      `🚨 SEND-SAFETY: bloqueei uma resposta no chat errado!\n` +
      `Pergunta veio de: ${destinoOrigem}\nResposta ia para: ${destinoAlvo}\n` +
      `Nada foi enviado. Confere o roteamento aí. — Luna`;
    if (deps.telegram?.botToken && deps.telegram.teamChatId) {
      try {
        await sendTeamMessage(alerta, deps.telegram);
      } catch (err) {
        log.error({ err }, 'send-safety: alerta Telegram falhou');
      }
    } else {
      log.error({ alerta }, 'send-safety: TELEGRAM não configurado — alerta NÃO enviado (falha explícita registrada)');
    }
    log.error({ message_id: messageId, ia_para: destinoAlvo, pergunta_veio_de: destinoOrigem }, 'SEND-SAFETY: entrega bloqueada (mismatch de conversa)');
    throw new Error('send_safety_blocked');
  }

  async function deliverOne(messageId: string): Promise<void> {
    const res = await pool.query<OutboundMessageRow>(
      `SELECT m.id, m.body, m.conversation_id, ct.address, ct.name AS contact_name,
              cv.metadata->>'chat_id' AS conversation_chat_id,
              m.metadata->>'correlation_id' AS correlation_id,
              m.metadata->>'reply_to_query' AS reply_to_query,
              m.metadata
       FROM messages m
       JOIN conversations cv ON cv.id = m.conversation_id
       LEFT JOIN contacts ct ON ct.id = cv.contact_id
       WHERE m.id = $1 AND m.send_state = 'queued'
         AND (m.metadata->>'next_retry_at' IS NULL OR (m.metadata->>'next_retry_at')::timestamptz <= now())`,
      [messageId],
    );
    if (!res.rowCount) return; // já entregue ou não existe
    const row = res.rows[0]!;
    // 2026-10-13 (bug ao vivo): conversas criadas pelo fallback do painel
    // (org→client→conversation) chegam SEM contact_id — mas o metadata.chat_id
    // tem o jid/dígitos do destino. Sem esse fallback TODA resposta morria em
    // 'sem contato/alvo de entrega' antes mesmo de abrir o chat.
    const chatIdFallback = row.conversation_chat_id
      ? /^\d{8,}$/.test(row.conversation_chat_id)
        ? `${row.conversation_chat_id}@s.whatsapp.net`
        : row.conversation_chat_id
      : null;
    const target = row.address ?? row.contact_name ?? chatIdFallback;
    if (!target) {
      await mark(messageId, 'failed', 'sem contato/alvo de entrega');
      return;
    }
    // 2026-10-13 (bug ao vivo, screenshot do owner): GRUPO chegava aqui como jid
    // (@g.us) e o openChat pesquisava os DÍGITOS do id na busca do WA — que não
    // acha grupo nenhum ("No se encontró ningún chat"). Busca de grupo é por
    // NOME (igual humano faz). Contatos privados seguem pelo número/jid
    // (deeplink /send resolve direto). Allowlist/send-safety continuam no jid.
    // 2026-10-14 (bug ao vivo, msg 646af5fe 10:39 UTC): dígitos puros com prefixo
    // 120363 são JID de GRUPO (novos grupos do WA) — o fallback de cima os veste de
    // @s.whatsapp.net e o deeplink/busca por número nunca acha nada. Grupo se abre
    // por NOME (busca do WA não indexa JID): contact_name → chat_registry →
    // conversations.metadata.chat_name. Sem nome resolvido = failed EXPLÍCITO sem
    // retry (re-tentar só polui a busca com número lixo, screenshot owner 19:48).
    const isGroupJid =
      /@g\.us$/.test(row.address ?? '') ||
      /@g\.us$/.test(row.conversation_chat_id ?? '') ||
      /^120363\d{9,}$/.test(row.conversation_chat_id ?? '');
    let sendTarget = target;
    if (isGroupJid) {
      const jidDigits = (row.conversation_chat_id ?? row.address ?? '').replace(/\D/g, '');
      let groupName: string | null = row.contact_name ?? null;
      if (!groupName && jidDigits) {
        try {
          const reg = await pool.query<{ canonical_name: string }>(
            `SELECT canonical_name FROM chat_registry
             WHERE kind = 'group' AND (chat_key = $1 OR chat_key LIKE $2) LIMIT 1`,
            [jidDigits, jidDigits + '@%'],
          );
          groupName = reg.rows[0]?.canonical_name ?? null;
        } catch { groupName = null; }
      }
      if (!groupName && jidDigits) {
        try {
          const cvn = await pool.query<{ n: string | null }>(
            `SELECT NULLIF(metadata->>'chat_name','') AS n FROM conversations
             WHERE metadata->>'chat_id' = $1 LIMIT 1`,
            [jidDigits],
          );
          groupName = cvn.rows[0]?.n ?? null;
        } catch { groupName = null; }
      }
      if (!groupName) {
        await mark(messageId, 'failed', 'grupo não resolvido: JID sem nome no registry');
        return;
      }
      sendTarget = groupName;
    }
    // SEND-SAFETY antes de tudo: vínculo pergunta→resposta íntegro.
    try {
      await sendSafetyCheck(messageId, row.conversation_id);
    } catch (err) {
      if (String(err).includes('send_safety_blocked')) return; // já auditado/alertado/bloqueado
      throw err;
    }
    // 2026-10-14 (bug ao vivo): pra GRUPO o allowlist check tem que ser no
    // NOME resolvido (sendTarget) — a allowlist do owner tem nomes de grupo,
    // e o jid @g.us nunca casa com entrada de nome. Individual: inalterado
    // (sendTarget === target).
    const allowTarget = isGroupJid ? sendTarget : target;
    const refusal = (await refusedByAllowlist(allowTarget)) && !(await notifySendExempt(messageId, target))
      ? refusedByAllowlist(allowTarget)
      : null;
    if (refusal) {
      // Falha EXPLÍCITA: marca failed, audita a recusa, nunca silencioso.
      await mark(messageId, 'failed', refusal);
      await recordAudit(pool, {
        actor: 'whatsplay',
        action: 'whatsapp.message.send_refused',
        tool: 'whatsplay_transport',
        correlation_id: row.correlation_id,
        result: 'failed',
        metadata: { message_id: messageId, target, reason: 'outbound_allowlist', detail: refusal },
      });
      // Se a mensagem era uma delivery de notificação (§22), reflete o
      // resultado real na notifications — 'sent' da fila ≠ entregue.
      const notifId = await pool
        .query<{ id: string }>(
          `SELECT id FROM notifications WHERE id = (SELECT (metadata->>'notification_delivery')::text FROM messages WHERE id = $1)`,
          [messageId],
        )
        .catch(() => ({ rows: [] as Array<{ id: string }> }));
      if (notifId.rows[0]) {
        await pool.query(
          `UPDATE notifications SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
          [notifId.rows[0].id, `entrega recusada: ${refusal}`],
        );
      }
      log.error({ message_id: messageId, target, refusal }, 'GUARDRAIL: envio recusado pela allowlist');
      return;
    }
    try {
      // Anti-ban: gente não responde em 300ms. Espera configurada + jitter
      // curto (3-4s, decreto owner), e o sendMessage ainda soma typing delay.
      // Anti-ban: espera humana DENTRO de cada tentativa (inclusive reparos).
      const send = async (opts: { suggestedSelector: string | null; attempt: number }) => {
        const base = deps.humanDelayMs ?? 3_500;
        const wait = base + Math.floor(Math.random() * 1_000);
        deps.log.info({ message_id: messageId, wait_ms: wait }, 'espera humana antes de enviar');
        await new Promise((r) => setTimeout(r, wait));
        // Defesa em profundidade na fronteira de entrega (bug ao vivo
        // 2026-09-22): se o body no banco estiver com o envelope ANSWER
        // cru ({"type":"ANSWER","text":"..."}), desembrulha antes de
        // sanitizar — a fila envenenada se autocura no reenvio.
        const raw = extractAnswerEnvelopeText(row.body) ?? row.body;
        const texto = sanitizeOutboundText(raw);
        // 🆕 CITAÇÃO: metadata reply_to_query → responde A mensagem citada
        // (mention.respond v2). Falha explícita dentro de replyToMessage —
        // nunca degrada pra envio sem citação.
        if (row.reply_to_query && transport.replyToMessage) {
          deps.log.info({ message_id: messageId, query: row.reply_to_query.slice(0, 60), alvo: sendTarget }, 'entrega com CITAÇÃO (reply_to_query)');
          return withSendLock(() => transport.replyToMessage!(sendTarget, row.reply_to_query!, texto));
        }
        return withSendLock(() =>
          transport.sendMessage(
            sendTarget,
            texto,
            opts.suggestedSelector ? { inputSelector: opts.suggestedSelector } : undefined,
          ),
        );
      };
      if (deps.adapter) {
        // §14: envio com auto-reparo (screenshot + visão + máx 3 tentativas).
        await withAutoRepair(
          { pool, adapter: deps.adapter, transport: transport as RepairableTransport, log, telegram: deps.telegram },
          'sendMessage',
          { conversationTarget: target, correlationId: row.correlation_id },
          send,
        );
      } else {
        await send({ suggestedSelector: null, attempt: 1 });
      }
      await mark(messageId, 'sent');
      await recordAudit(pool, {
        actor: 'whatsplay',
        action: 'whatsapp.message.sent',
        tool: 'whatsplay_transport',
        correlation_id: row.correlation_id,
        result: 'success',
        metadata: { message_id: messageId, target },
      });
      log.info({ message_id: messageId, target }, 'resposta entregue no WhatsApp');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      // 2026-10-14 (silêncio ao vivo): falha única de entrega (página WA
      // instável) virava 'failed' PERMANENTE e o usuário nunca sabia. Agora
      // reenfileira com backoff (máx 4 retries). Bloqueios de segurança
      // (send-safety/allowlist) continuam falha imediata — nunca retentam.
      const seguranca = /send_safety|allowlist|blocklist|recusa/i.test(errorMsg);
      const attempts = Number((row as unknown as { metadata?: { delivery_attempts?: number } }).metadata?.delivery_attempts ?? 0) + 1;
      if (!seguranca && attempts < 5) {
        const backoffSec = Math.min(60 * attempts, 300);
        await pool.query(
          `UPDATE messages SET metadata = COALESCE(metadata,'{}'::jsonb) || $2::jsonb WHERE id = $1`,
          [messageId, JSON.stringify({ delivery_attempts: attempts, next_retry_at: new Date(Date.now() + backoffSec * 1000).toISOString() })],
        );
        log.warn({ message_id: messageId, attempts, backoffSec }, 'entrega falhou — reenfileirada com backoff');
        setTimeout(() => {
          deliverOne(messageId).catch((e2: unknown) => log.error({ err: e2 }, 'retry de entrega falhou'));
        }, backoffSec * 1000);
        return;
      }
      await mark(messageId, 'failed', errorMsg);
      await recordAudit(pool, {
        actor: 'whatsplay',
        action: 'whatsapp.message.send_failed',
        tool: 'whatsplay_transport',
        correlation_id: row.correlation_id,
        result: 'failed',
        metadata: { message_id: messageId, target, error: errorMsg },
      });
      // Paridade com o caminho de recusa: delivery de notificação (§22)
      // reflete o resultado real.
      const notifId = await pool
        .query<{ id: string }>(
          `SELECT id FROM notifications WHERE id = (SELECT (metadata->>'notification_delivery')::text FROM messages WHERE id = $1)`,
          [messageId],
        )
        .catch(() => ({ rows: [] as Array<{ id: string }> }));
      if (notifId.rows[0]) {
        await pool.query(
          `UPDATE notifications SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
          [notifId.rows[0].id, `entrega falhou: ${errorMsg}`],
        );
      }
      log.error({ err, message_id: messageId }, 'falha ao entregar resposta');
    }
  }

  async function mark(messageId: string, state: 'sent' | 'failed', error?: string): Promise<void> {
    await pool.query(
      `UPDATE messages SET send_state = $2, sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END,
         metadata = metadata || $3::jsonb
       WHERE id = $1`,
      [messageId, state, error ? JSON.stringify({ send_error: error }) : '{}'],
    );
  }

  /** Conecta e escuta. Retorna o client LISTEN para o shutdown fechar. */
  async function start(): Promise<PoolClient> {
    const client = await pool.connect();
    await client.query('LISTEN luna_outbound');
    client.on('notification', (n) => {
      if (n.payload) deliverOne(n.payload).catch((err) => log.error({ err }, 'entrega falhou'));
    });
    log.info('ouvindo NOTIFY luna_outbound (fila de saída)');
    // Dreno no boot: NOTIFY disparado durante um restart do daemon se perde
    // (ninguém ouvindo) e a mensagem ficava 'queued' pra sempre — evidência
    // ao vivo 2026-09-22 (teste de entrega do owner travado em queued).
    const stale = await pool
      .query<{ id: string }>(
        `SELECT id FROM messages
         WHERE send_state = 'queued' AND created_at > now() - interval '6 hours'
           AND (metadata->>'next_retry_at' IS NULL OR (metadata->>'next_retry_at')::timestamptz <= now())
         ORDER BY created_at LIMIT 20`,
      )
      .catch(() => ({ rows: [] as Array<{ id: string }> }));
    for (const row of stale.rows) {
      log.info({ message_id: row.id }, 'fila: mensagem queued encontrada no boot — drenando');
      deliverOne(row.id).catch((err) => log.error({ err }, 'entrega falhou'));
    }
    return client;
  }

  return { start, deliverOne };
}

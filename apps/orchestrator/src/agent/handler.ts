import { readFileSync } from 'node:fs';
import type { Pool, PoolClient } from 'pg';
import type { Logger } from 'pino';
import type { EventEnvelope } from '@luna/events';
import { fileURLToPath } from 'node:url';
import type { KimiLiveAdapter } from '@luna/agent';
import { sendTeamMessage, type TelegramConfig } from '@luna/channels';
import { recordActivity, recordAudit, publishEvent, enqueueJob, type Sql } from '@luna/database';
import {
  buildClientConversationPack,
  renderConversationPrompt,
  buildClientProjectPack,
  buildAdminFullPack,
  renderPackPrompt,
  type ClientConversationPack,
} from './context.js';
import { transitionConversation, getConversationState } from './attention.js';
import { runFastRoute, selectRoute } from './router/router.js';
import { isExplicitHumanRequest } from './router/structured.js';

/**
 * Handler de mensagens de cliente — o ciclo vivo com MODEL ROUTER
 * (contrato v1.1): evento → route determinística (§10) → client lock (§19)
 * → estado AI_HANDLING (§7.11) → FAST estruturado (§5, guardas §5.1) →
 * entrega / handoff (§6, ADR-023) / escalación (§8) → usage ledger (§23/§28)
 * → agent_runs + activity (humano) + audit (máquina, correlation_id).
 *
 * ADR-026/§8: durante HUMAN_HANDLING a Luna NÃO responde o cliente — a
 * mensagem é anexada ao contexto da escalación.
 */

export interface MessageHandlerDeps {
  pool: Pool;
  adapter: KimiLiveAdapter;
  log: Logger;
  telegram?: TelegramConfig;
}

interface HandlerPayload {
  conversation_id?: string;
  text?: string;
  /** Quem falou (nome do membro no grupo / contato no privado). */
  author_name?: string | null;
  /** true se a mensagem veio de grupo (detecção de humano na escalção). */
  is_group?: boolean;
  /** true = o texto menciona a Luna (calculado no whatsplay, watcher sweep). */
  mentioned_luna?: boolean;
  /** Autor da mensagem citada (reply) — citar a Luna conta como menção. */
  quoted_author?: string | null;
  /** true = mensagem de canal real (WhatsPlay entrega); false = simulação. */
  deliver?: boolean;
}

// ── Usage ledger (§23/§28): preços versionados em config/prices.json ──
interface PricesFile {
  currency: string;
  models: Record<string, { input_per_1M: number; output_per_1M: number }>;
  billable: { multiplier: number };
}

/** Escalada sem atividade humana expira após 45min (decreto owner 14/10):
 *  melhor a Luna voltar a responder do que engolir mensagens pra sempre. */
const ESCALATION_STALE_MS = 45 * 60_000;

let pricesCache: PricesFile | null = null;
function loadPrices(): PricesFile {
  if (pricesCache) return pricesCache;
  pricesCache = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../../config/prices.json', import.meta.url)), 'utf8'),
  ) as PricesFile;
  return pricesCache;
}

export function estimateCost(
  model: string,
  usage: { input_tokens: number; output_tokens: number },
): { estimated_cost: number; billable_units: number } | null {
  const prices = loadPrices();
  const p = prices.models[model];
  if (!p) return null;
  const estimated_cost =
    (usage.input_tokens / 1_000_000) * p.input_per_1M +
    (usage.output_tokens / 1_000_000) * p.output_per_1M;
  return {
    estimated_cost: Number(estimated_cost.toFixed(6)),
    billable_units: Math.max(1, Math.ceil(estimated_cost * prices.billable.multiplier)),
  };
}

export function createMessageHandler(deps: MessageHandlerDeps) {
  const { pool, adapter, log } = deps;
  const eventPool = pool; // publishEvent precisa de Pool (client dedicado do lock é PoolClient)

  async function escalate(
    db: Sql,
    event: EventEnvelope,
    conversationId: string,
    input: { reason: string; priority: string; summary: string; trigger: string },
  ): Promise<void> {
    await transitionConversation(db, conversationId, 'NEEDS_HUMAN');
    await transitionConversation(db, conversationId, 'HUMAN_NOTIFIED');
    await db.query(
      `INSERT INTO escalations (client_id, conversation_id, reason, priority, status, notified_at, metadata)
       VALUES ($1, $2, $3, $4, 'notified', now(), $5)`,
      [
        event.client_id,
        conversationId,
        input.reason,
        input.priority,
        { summary: input.summary, trigger: input.trigger, correlation_id: event.correlation_id },
      ],
    );
    await publishRouterEvent(db, event, 'router.escalate.human', {
      trigger: input.trigger,
      priority: input.priority,
    });
    // §8 cascata: ligação (F6, pendente) → mensagem viva ao grupo do time.
    // 2026-10-14 (decreto owner): o Telegram do time nunca chegou pra
    // ninguém — a criação da escalation alerta NA HORA no WhatsApp do owner.
    try {
      const { alertOwnerWhatsApp } = await import('@luna/database');
      const escId = (await db.query<{ id: string }>(`SELECT id FROM escalations WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1`, [conversationId])).rows[0]?.id ?? 'unknown';
      await alertOwnerWhatsApp(eventPool, [
        `🙋 Escalation ${input.priority}: ${input.reason}`,
        `Resumo: ${input.summary || '(ver painel)'}`,
        `Me responde aqui com "ok" se vai pegar — se não responder no SLA eu insisto e te ligo.`,
      ].join('\n'), { escalation_id: escId, priority: input.priority, stage: 'created' });
    } catch (err) {
      log.error({ err }, 'escalation: alerta WhatsApp de criação falhou (explícito)');
    }
    if (deps.telegram?.botToken && deps.telegram.teamChatId) {
      try {
        await sendTeamMessage(
          `🙋 Escalación ${input.priority}: ${input.reason}. Resumo: ${input.summary || '(ver escalations)'} — quem puder atende 🙏`,
          deps.telegram,
        );
      } catch (err) {
        log.error({ err }, 'escalación: alerta Telegram falhou');
      }
    } else {
      log.error('escalación: TELEGRAM não configurado — alerta NÃO enviado (falha explícita registrada)');
    }
    await recordActivity(db, {
      client_id: event.client_id,
      kind: 'incident',
      summary: `Escalonei para humano (${input.priority}): ${input.reason}. Time notificado.`,
      correlation_id: event.correlation_id,
    });
  }

  async function publishRouterEvent(
    db: Sql,
    event: EventEnvelope,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await publishEvent(eventPool, {
      event_type: eventType,
      source: 'model_router',
      client_id: event.client_id,
      conversation_id: event.conversation_id,
      correlation_id: event.correlation_id,
      causation_id: event.event_id,
      payload,
    });
  }

  async function processLocked(
    db: Sql & Pick<PoolClient, 'query'>,
    event: EventEnvelope,
    payload: HandlerPayload,
  ): Promise<void> {
    const conversationId = payload.conversation_id!;
    const text = payload.text ?? '';

    // Reprocessamento (retry do dispatcher)? Resposta já existe → ignora.
    const already = await db.query(
      `SELECT id FROM messages
       WHERE conversation_id = $1 AND direction = 'outbound'
         AND metadata->>'reply_to_event' = $2
       LIMIT 1`,
      [conversationId, event.event_id],
    );
    if (already.rowCount) {
      log.info({ event_id: event.event_id }, 'resposta já existe — evento duplicado ignorado');
      await recordAudit(db, {
        actor: 'orchestrator',
        action: 'agent.reply.duplicate_ignored',
        tool: 'message_handler',
        correlation_id: event.correlation_id,
        result: 'success',
        metadata: { event_id: event.event_id },
      });
      return;
    }

    // ADR-026/§8: durante HUMAN_HANDLING a Luna não fala por cima do humano.
    // ADR-025: humano respondendo = transição consciente; humano EXTRA = status,
    // jamás re-escalação. Detecção: em GRUPO, autor != contato do cliente.
    const state = await getConversationState(db, conversationId);
    // 2026-10-14 (bug ao vivo "lê e não responde", decreto owner): escalada
    // aberta engolia TODA mensagem nova SEM resposta — e ficava presa pra
    // sempre quando nenhum humano do time assumia (caso real: 07:22 → 12:12,
    // 5h de DM do Abner engolidas). Agora: sem atividade humana por
    // ESCALATION_STALE_MS, a escalada EXPIRA, a conversa volta pra IA e a
    // mensagem corrente segue pelo fluxo normal (Luna responde de novo).
    let humanGateActive = state === 'HUMAN_HANDLING' || state === 'NEEDS_HUMAN' || state === 'HUMAN_NOTIFIED';
    if (humanGateActive) {
      const openEsc = await db.query<{ id: string; last_activity: string | null }>(
        `SELECT id, COALESCE(last_handled_at, notified_at, created_at) AS last_activity
         FROM escalations
         WHERE conversation_id = $1 AND status IN ('notified','handling')
         ORDER BY created_at DESC LIMIT 1`,
        [conversationId],
      );
      const escRow = openEsc.rows[0];
      if (escRow && Date.now() - new Date(escRow.last_activity as string).getTime() > ESCALATION_STALE_MS) {
        await db.query(`UPDATE escalations SET status = 'expired', updated_at = now() WHERE id = $1`, [escRow.id]);
        await transitionConversation(db, conversationId, 'AI_HANDLING');
        await recordAudit(db, {
          actor: 'orchestrator', action: 'escalation.auto_expired', tool: 'message_handler',
          client_id: event.client_id, correlation_id: event.correlation_id, result: 'success',
          metadata: { escalation_id: escRow.id, stale_ms: ESCALATION_STALE_MS },
        });
        log.info({ escalation_id: escRow.id, conversation_id: conversationId }, 'escalation expirada por inatividade humana — Luna volta a responder');
        humanGateActive = false;
      } else if (!escRow) {
        // 2026-10-15 (bug ao vivo, owner: "mandei várias e ela nada"): gate
        // ativo SEM escalada aberta = estado preso. Acontece quando a
        // escalada expirou/foi resolvida por outro caminho e ninguém girou a
        // conversa de volta pra IA — a conversa ficava em HUMAN_NOTIFIED pra
        // sempre e TODO inbound era engolido "anexado à escalación" (caso
        // real: 20:33 → 07:11+, ~11h de DM do Abner sem resposta). Sem gate
        // aberto não há humano assumindo: recupera pra AI_HANDLING e a
        // mensagem corrente segue o fluxo normal.
        await transitionConversation(db, conversationId, 'AI_HANDLING');
        await recordAudit(db, {
          actor: 'orchestrator', action: 'escalation.stale_gate_recovered', tool: 'message_handler',
          client_id: event.client_id, correlation_id: event.correlation_id, result: 'success',
          metadata: { prev_state: state },
        });
        log.info({ conversation_id: conversationId, prev_state: state }, 'gate humano sem escalada aberta — conversa recuperada pra AI_HANDLING');
        humanGateActive = false;
      }
    }
    if (humanGateActive) {
      const contactName = await db
        .query<{ name: string | null }>(
          `SELECT ct.name FROM conversations cv LEFT JOIN contacts ct ON ct.id = cv.contact_id WHERE cv.id = $1`,
          [conversationId],
        )
        .then((r) => r.rows[0]?.name ?? null);
      const author = payload.author_name ?? null;
      const isGroup = payload.is_group === true;
      const isHuman = isGroup && author !== null && author !== contactName;

      if (isHuman && state !== 'NEEDS_HUMAN') {
        const open = await db.query<{ id: string; handled_by: string | null }>(
          `SELECT id, handled_by FROM escalations
           WHERE conversation_id = $1 AND status IN ('notified','handling') ORDER BY created_at DESC LIMIT 1`,
          [conversationId],
        );
        const esc = open.rows[0];
        if (esc && (!esc.handled_by || esc.handled_by === author)) {
          // Humano (o mesmo que atendeu) falando — atualiza atividade.
          await db.query(
            `UPDATE escalations SET status = 'handling', handled_by = $2, last_handled_at = now(), updated_at = now() WHERE id = $1`,
            [esc.id, author],
          );
          if (state !== 'HUMAN_HANDLING') {
            await transitionConversation(db, conversationId, 'HUMAN_HANDLING');
            await recordAudit(db, {
              actor: 'orchestrator', action: 'escalation.human.responded', tool: 'message_handler',
              client_id: event.client_id, correlation_id: event.correlation_id, result: 'success',
              metadata: { escalation_id: esc.id, handled_by: author },
            });
          }
        } else if (esc && esc.handled_by && esc.handled_by !== author) {
          // Humano EXTRA (ADR-025): status, nunca re-escalação.
          await recordAudit(db, {
            actor: 'orchestrator', action: 'escalation.coordination.status', tool: 'message_handler',
            client_id: event.client_id, correlation_id: event.correlation_id, result: 'success',
            metadata: { escalation_id: esc.id, handled_by: esc.handled_by, extra_human: author },
          });
          if (deps.telegram?.botToken && deps.telegram.teamChatId) {
            try {
              const { sendTeamMessage } = await import('@luna/channels');
              await sendTeamMessage(
                `🤝 Coordenação: ${author} entrou na conversa, mas ${esc.handled_by} já está cuidando do caso. ` +
                  `Status: segue com ${esc.handled_by} (jamás re-escalação, ADR-025).`,
                deps.telegram,
              );
            } catch (err) {
              log.error({ err }, 'coordenação: status Telegram falhou');
            }
          }
        }
      }

      log.info({ state, conversation_id: conversationId }, 'HUMAN_HANDLING ativo — mensagem anexada à escalación, sem resposta automática');
      await recordAudit(db, {
        actor: 'orchestrator',
        action: 'escalation.client_message_appended',
        tool: 'message_handler',
        client_id: event.client_id,
        correlation_id: event.correlation_id,
        result: 'success',
        metadata: { conversation_id: conversationId, state, text: text.slice(0, 120) },
      });
      await recordActivity(db, {
        client_id: event.client_id,
        kind: 'info',
        summary: `Mensagem anexada à escalación em andamento (Luna silenciada, §8).`,
        correlation_id: event.correlation_id,
      });
      return;
    }

    // PONTE KIMI WORK (decreto owner 2026-09-24, fix double-send 2026-09-24):
    // mensagem de WhatsApp já entregue ao cérebro Kimi Work via kimiwork_inbox
    // (mesma correlation_id). Lá é a via canônica de resposta — a varredura
    // dedicada (Kimi Work) responde por INSERT em messages + luna_outbound.
    // Se o model router responder também, o cliente recebe a MESMA resposta
    // DUAS vezes (bug ao vivo: "Por nada, Enoque!" duplicada no painel).
    // EXCEÇÃO §8.1: pedido explícito de humano NUNCA é skipado — a escalación
    // imediata é prioridade, zero tentativas de IA.
    // Skip apenas do caminho de IA: coordenação de HUMAN_HANDLING (acima) e
    // trilha de audit continuam valendo.
    if (
      event.event_type === 'whatsapp.message.received' &&
      !isExplicitHumanRequest(text)
    ) {
      const bridged = process.env.KIMI_ADAPTER_MODE === 'kimiwork' ? await db.query(
        `SELECT id FROM kimiwork_inbox
         WHERE kind = 'whatsapp.message' AND status <> 'error'
           AND payload->>'correlation_id' = $1 LIMIT 1`,
        [event.correlation_id],
      ) : ({ rowCount: 0, rows: [] } as never);
      if (bridged.rowCount) {
        log.info({ event_id: event.event_id, correlation_id: event.correlation_id, kimiwork_event_id: bridged.rows[0].id },
          'ponte Kimi Work: mensagem já na inbox dedicada — model router NÃO responde (anti double-send)');
        await recordAudit(db, {
          actor: 'orchestrator',
          action: 'agent.reply.bridge_kimiwork_skipped',
          tool: 'message_handler',
          client_id: event.client_id,
          correlation_id: event.correlation_id,
          result: 'success',
          metadata: { event_id: event.event_id, kimiwork_event_id: (bridged.rows[0] as { id: string }).id },
        });
        return;
      }
    }

    // 2026-10-14 (decreto owner "braços potentes"): em grupo a decisão de
    // falar/ficar muda é DO MODELO (saída SILENCE do FAST), não um hardcode
    // aqui. O gate duro de menção que existiu neste ponto foi removido.
    const runStartedAt = new Date();
    await transitionConversation(db, conversationId, 'AI_HANDLING');

    // Vision (owner 27/09): mensagem com imagem → anexa base64 ao turno do
    // FAST (adapter já suporta image_base64; o modelo vision é escolhido no
    // adapter). Arquivo sumiu/ilegível → log e segue só com texto.
    let imageBase64: string | undefined;
    const imagePath = (payload as { image_path?: string | null }).image_path;
    if (imagePath) {
      try {
        const { readFileSync } = await import('node:fs');
        const buf = readFileSync(imagePath);
        if (buf.byteLength <= 7 * 1024 * 1024) imageBase64 = buf.toString('base64');
        else log.warn({ imagePath, bytes: buf.byteLength }, 'imagem acima de 7MB — turno segue sem visão');
      } catch (err) {
        log.warn({ err: String(err).slice(0, 120), imagePath }, 'imagem ilegível — turno segue sem visão');
      }
    }

    // §10: route determinística primeiro — o context pack vem DA ROUTE (§7.9):
    // só o contexto relevante, nunca "tudo".
    const route = await selectRoute({ pool: eventPool, adapter, log }, event);
    let pack: ClientConversationPack | import('./context.js').ContextPack;
    let prompt: string;
    if (route.contextPack === 'ADMIN_FULL') {
      const adminPack = await buildAdminFullPack(db);
      pack = adminPack;
      prompt = renderPackPrompt(adminPack, text, payload.author_name);
    } else if (route.contextPack === 'CLIENT_PROJECT') {
      const projectPack = await buildClientProjectPack(db, conversationId);
      pack = projectPack;
      prompt = renderPackPrompt(projectPack, text, payload.author_name);
    } else {
      const convPack = await buildClientConversationPack(db, conversationId);
      pack = convPack;
      prompt = renderConversationPrompt(convPack, text, payload.author_name);
    }
    const packName = (pack as { name?: string }).name ?? 'CLIENT_CONVERSATION';

    const decision = await runFastRoute(
      { pool: eventPool, adapter, log },
      {
        event,
        prompt,
        sessionKey: conversationId,
        allowLiveHandoff: route.allowLiveHandoff,
        imageBase64,
        // Config da route (§4, routes.json) — investigation_budget /
        // investigation_timeout_ms, zero hardcode.
        investigationBudget: route.investigationBudget,
        investigationTimeoutMs: route.investigationTimeoutMs,
      },
    );

    // SILENCE (decreto owner 14/10): o modelo viu a mensagem e decidiu que
    // não deve falar (grupo, conversa entre humanos, sem valor real). Nada
    // de outbound — só trilha de audit pra gente saber que ela escolheu calar.
    if (decision.output.type === 'SILENCE') {
      log.info(
        { event_id: event.event_id, author: payload.author_name, reason: (decision.output as { reason?: string }).reason },
        'FAST decidiu SILENCE — Luna fica muda nesta mensagem',
      );
      await transitionConversation(db, conversationId, 'RESOLVED');
      await recordAudit(db, {
        actor: 'orchestrator',
        action: 'agent.reply.silence',
        tool: 'message_handler',
        client_id: event.client_id,
        correlation_id: event.correlation_id,
        result: 'success',
        metadata: {
          event_id: event.event_id,
          author: payload.author_name,
          is_group: payload.is_group === true,
          reason: (decision.output as { reason?: string }).reason ?? '',
        },
      });
      return;
    }

    // Resposta persistida. deliver=false (simulação) não entra na fila de envio.
    const deliver = payload.deliver !== false;
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO messages (conversation_id, direction, channel, sender, body, author_name, metadata, send_state)
       VALUES ($1, 'outbound', $2, 'luna', $3, 'Luna', $4, $5)
       RETURNING id`,
      [
        conversationId,
        (pack as { channel?: string }).channel ?? 'whatsapp',
        decision.answerText,
        {
          reply_to_event: event.event_id,
          correlation_id: event.correlation_id,
          adapter: adapter.mode,
          router_output: decision.output.type,
          tool_rounds: decision.toolRounds,
        },
        deliver ? 'queued' : 'simulated',
      ],
    );
    const replyMessageId = inserted.rows[0]!.id;
    if (deliver) {
      await db.query('SELECT pg_notify($1, $2)', ['luna_outbound', replyMessageId]);
    }

    // Usage ledger (§23/§28): provider/modelo reais + estimated_cost (BLOCO 4).
    if (decision.turn.usage) {
      const cost = estimateCost(decision.turn.model ?? 'unknown', decision.turn.usage);
      await db.query(
        `INSERT INTO usage_entries (client_id, event_id, provider, model, input_tokens, output_tokens, estimated_cost, billable_units)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          event.client_id,
          event.event_id,
          decision.turn.provider ?? adapter.mode,
          decision.turn.model ?? adapter.mode,
          decision.turn.usage.input_tokens,
          decision.turn.usage.output_tokens,
          cost?.estimated_cost ?? 0,
          cost?.billable_units ?? 0,
        ],
      );
    }

    const finishedAt = new Date();
    await db.query(
      `INSERT INTO agent_runs (event_id, client_id, agent, brain, status, input, output, started_at, finished_at)
       VALUES ($1, $2, 'luna', $3, 'completed', $4, $5, $6, $7)`,
      [
        event.event_id,
        event.client_id,
        adapter.mode,
        {
          prompt_lines: prompt.split('\n').length,
          pack: {
            name: packName,
            client: (pack as { client_name?: string }).client_name ?? 'admin',
          },
          route: route.destination,
          router_output: decision.output.type,
          tool_rounds: decision.toolRounds,
        },
        {
          reply_text: decision.answerText,
          session_id: decision.turn.session_id,
          reply_message_id: replyMessageId,
          handoff: decision.handoff,
          escalate: decision.escalate,
        },
        runStartedAt,
        finishedAt,
      ],
    );

    // Destino final da conversa (§7.11 + §8).
    if (decision.escalate && decision.output.type === 'ESCALATE_HUMAN') {
      const esc = decision.output;
      await escalate(db, event, conversationId, {
        reason: esc.reason,
        priority: esc.priority,
        summary: esc.summary,
        trigger: esc.reason.includes('explícito') ? 'explicit_human_request' : 'guardrail_or_loop',
      });
    } else if (decision.handoff) {
      // ADR-023: handoff registrado; investigação ao vivo espera o live brain.
      await transitionConversation(db, conversationId, 'RESOLVED');
      await publishRouterEvent(db, event, 'router.investigation.pending_live', {
        objective: decision.output.type === 'HANDOFF_LIVE' ? decision.output.objective : '',
        budget: 3,
        timeout_ms: 600_000,
      });
      await recordActivity(db, {
        client_id: event.client_id,
        kind: 'info',
        summary: `Handoff registrado (investigação pendente do live brain, ADR-023): ${decision.output.type === 'HANDOFF_LIVE' ? decision.output.objective : ''}`.slice(0, 180),
        correlation_id: event.correlation_id,
      });
    } else {
      await transitionConversation(db, conversationId, 'RESOLVED');
      // §27: classificação pós-conversa — job pro worker (cola, §7.12).
      await enqueueJob(db, {
        job_type: 'conversation.classify',
        payload: {
          conversation_id: conversationId,
          client_id: event.client_id,
          correlation_id: event.correlation_id,
        },
        idempotency_key: `classify:${event.event_id}`,
      });
    }

    // §20 — activity (humano) + audit (máquina), correlation_id presente.
    const snippet = text.length > 60 ? `${text.slice(0, 60)}…` : text;
    const author = payload.author_name ?? (pack as { contact_name?: string | null }).contact_name ?? (pack as { client_name?: string }).client_name ?? `admin (${packName})`;
    const clientLabel = (pack as { client_name?: string }).client_name ?? packName;
    await recordActivity(db, {
      client_id: event.client_id,
      kind: decision.escalate ? 'incident' : 'action',
      summary: decision.escalate
        ? `Escalonei ${author} (${clientLabel}) para humano: "${snippet}"`
        : `Respondi ${author} (${clientLabel}): "${snippet}"`,
      correlation_id: event.correlation_id,
    });
    await recordAudit(db, {
      actor: 'orchestrator',
      action: 'agent.run.completed',
      tool: 'model_router',
      client_id: event.client_id,
      correlation_id: event.correlation_id,
      duration_ms: decision.turn.duration_ms,
      result: 'success',
      metadata: {
        event_id: event.event_id,
        conversation_id: conversationId,
        adapter: adapter.mode,
        router_output: decision.output.type,
        tool_rounds: decision.toolRounds,
        deliver,
      },
    });

    log.info(
      { event_id: event.event_id, correlation_id: event.correlation_id, conversation_id: conversationId, router_output: decision.output.type, tool_rounds: decision.toolRounds },
      'cliente respondido (router)',
    );
  }

  return async function handleClientMessage(event: EventEnvelope): Promise<void> {
    const payload = event.payload as HandlerPayload;
    const conversationId = payload.conversation_id;
    if (!conversationId) {
      throw new Error(`${event.event_type} sem conversation_id no payload`);
    }

    // Client lock (§19): mensagens da mesma conversa em série; clientes
    // diferentes em paralelo. Lock transacional Postgres.
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [
        `luna:conv:${conversationId}`,
      ]);
      await processLocked(client, event, payload);
    } finally {
      await client
        .query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [`luna:conv:${conversationId}`])
        .catch(() => {});
      client.release();
    }
  };
}

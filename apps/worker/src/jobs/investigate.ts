import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { KimiLiveAdapter } from '@luna/agent';
import { publishEvent, recordAudit } from '@luna/database';
import { sendTeamMessage, type TelegramConfig } from '@luna/channels';
import type { JobHandler, JobRow } from './poller.js';

/**
 * Investigação HANDOFF_LIVE (§6 real — fecha a degradação ADR-023).
 *
 * O FAST não tinha dado/ferramenta → HANDOFF_LIVE → job `investigate` →
 * Cérebro Vivo (KimiCliAdapter, ADR-033) investiga com tools nativas por
 * até `budget` rondas dentro do timeout de parede → conclusão entregue NO
 * MESMO thread da conversa (messages outbound + NOTIFY luna_outbound — o
 * caminho de send-safety do whatsplay). Budget esgotado/timeout/falha →
 * ESCALATE_HUMAN com resumo das rondas (§6). Eventos do contrato §11.
 *
 * O job roda com max_attempts=1: as rondas já são a estratégia de retry;
 * reexecutar o job inteiro re-investigiria do zero.
 */

export interface InvestigateDeps {
  pool: Pool;
  live: KimiLiveAdapter;
  log: Logger;
  telegram?: TelegramConfig;
}

interface InvestigatePayload {
  objective: string;
  context_summary?: string;
  conversation_id: string;
  client_id?: string;
  correlation_id?: string;
  chat_id?: string;
  author_name?: string;
  budget?: number;
  timeout_ms?: number;
}

interface Round {
  round: number;
  finding: string;
  duration_ms: number;
}

const ROUND_PROMPT = (objective: string, context: string, rounds: Round[], last: boolean): string =>
  [
    'Você é a Luna no CÉREBRO VIVO (HANDOFF_LIVE §6): o FAST não conseguiu responder sozinho e te passou a investigação.',
    `Objetivo: ${objective}`,
    context ? `Contexto acumulado: ${context}` : '',
    rounds.length
      ? `Rondas anteriores:\n${rounds.map((r) => `--- ronda ${r.round} ---\n${r.finding}`).join('\n')}`
      : '',
    last
      ? 'ÚLTIMA RONDA: feche a investigação. Responda em PT-BR com a RESPOSTA FINAL para o cliente ' +
        '(direta, sem mencionar rondas nem ferramentas). Se ainda não tem conclusão confiável, escreva ' +
        '"NÃO RESOLVIDO: <motivo>".'
      : 'Investigue (leia arquivos/logs/ferramentas disponíveis). Responda com o que DESCobriu nesta ronda ' +
        '(fatos + evidências), e o que falta investigar na próxima.',
  ]
    .filter(Boolean)
    .join('\n\n');

export function createInvestigateHandler(deps: InvestigateDeps): JobHandler {
  const { pool, live, log, telegram } = deps;

  async function publish(type: string, payload: InvestigatePayload, extra: Record<string, unknown>): Promise<void> {
    await publishEvent(pool, {
      event_type: type,
      source: 'live_investigation',
      client_id: payload.client_id ?? null,
      conversation_id: payload.conversation_id,
      correlation_id: payload.correlation_id ?? undefined,
      payload: extra,
      idempotency_key: `inv:${payload.correlation_id ?? payload.conversation_id}:${type}:${extra.round ?? extra.outcome ?? 'x'}`,
    });
  }

  async function deliverReply(payload: InvestigatePayload, text: string): Promise<string> {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO messages (conversation_id, direction, channel, sender, body, author_name, metadata, send_state)
       VALUES ($1, 'outbound', 'whatsapp', 'luna', $2, 'Luna', $3, 'queued') RETURNING id`,
      [
        payload.conversation_id,
        text,
        {
          correlation_id: payload.correlation_id ?? null,
          reply_source: 'live_investigation',
          chat_id: payload.chat_id ?? null,
        },
      ],
    );
    const id = inserted.rows[0]!.id;
    await pool.query('SELECT pg_notify($1, $2)', ['luna_outbound', id]);
    return id;
  }

  async function escalateWithSummary(payload: InvestigatePayload, rounds: Round[], reason: string): Promise<void> {
    const summary = [
      `Investigação HANDOFF_LIVE esgotada (${reason}).`,
      rounds.length ? `Rondas:\n${rounds.map((r) => `- R${r.round}: ${r.finding.slice(0, 300)}`).join('\n')}` : 'Sem rondas concluídas.',
    ].join('\n');
    await pool.query(
      `INSERT INTO escalations (client_id, conversation_id, reason, priority, status, notified_at, metadata)
       VALUES ($1, $2, $3, 'ALTA', 'notified', now(), $4)`,
      [
        payload.client_id ?? null,
        payload.conversation_id,
        `handoff_live: ${payload.objective}`.slice(0, 200),
        { summary, trigger: 'investigation_exhausted', correlation_id: payload.correlation_id ?? null },
      ],
    );
    await publish('router.investigation.exhausted', payload, { outcome: 'escalated', reason, rounds: rounds.length });
    if (telegram?.botToken && telegram.teamChatId) {
      try {
        await sendTeamMessage(`🙋 HANDOFF esgotado (${reason}): ${payload.objective}. Resumo das rondas no evento router.investigation.exhausted.`, telegram);
      } catch (err) {
        log.error({ err }, 'investigate: alerta Telegram falhou');
      }
    }
    await recordAudit(pool, {
      actor: 'live_investigation',
      action: 'router.investigation.exhausted',
      tool: 'investigate_job',
      correlation_id: payload.correlation_id ?? null,
      result: 'failed',
      metadata: { reason, rounds: rounds.length },
    });
  }

  return async function investigate(job: JobRow): Promise<void> {
    const payload = job.payload as unknown as InvestigatePayload;
    const budget = Math.max(1, payload.budget ?? 3);
    const timeoutMs = payload.timeout_ms ?? 600_000;
    const deadline = Date.now() + timeoutMs;
    const sessionKey = `investigate:${job.id}`;
    const rounds: Round[] = [];

    log.info({ job: job.id, objective: payload.objective, budget }, 'investigate: começando');

    for (let round = 1; round <= budget; round++) {
      if (Date.now() > deadline) {
        await escalateWithSummary(payload, rounds, 'timeout de parede');
        return;
      }
      const last = round === budget;
      const startedAt = Date.now();
      let finding: string;
      try {
        const turn = await live.sendTurn({
          session_key: sessionKey,
          prompt: ROUND_PROMPT(payload.objective, payload.context_summary ?? '', rounds, last),
        });
        finding = turn.reply_text;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err: msg, round }, 'investigate: ronda falhou');
        if (rounds.length === 0) throw err; // sem nada: o job falha pra visibilidade
        await escalateWithSummary(payload, rounds, `ronda ${round} falhou: ${msg.slice(0, 150)}`);
        return;
      }
      rounds.push({ round, finding, duration_ms: Date.now() - startedAt });
      await publish('router.investigation.round', payload, {
        round,
        budget,
        finding: finding.slice(0, 500),
      });

      const unresolved = /NÃO RESOLVIDO/i.test(finding);
      if (!last && unresolved) {
        await escalateWithSummary(payload, rounds, 'live brain declarou não-resolvido antes do budget');
        return;
      }
      if (last && unresolved) {
        await escalateWithSummary(payload, rounds, 'budget esgotado sem conclusão');
        return;
      }
    }

    // Conclusão: última ronda (prompt pediu RESPOSTA FINAL)
    const finalText = rounds[rounds.length - 1]!.finding;
    const messageId = await deliverReply(payload, finalText);
    await publish('router.investigation.completed', payload, {
      outcome: 'answered',
      rounds: rounds.length,
      reply_message_id: messageId,
    });
    await recordAudit(pool, {
      actor: 'live_investigation',
      action: 'router.investigation.completed',
      tool: 'investigate_job',
      correlation_id: payload.correlation_id ?? null,
      result: 'success',
      metadata: { rounds: rounds.length, reply_message_id: messageId },
    });
    log.info({ job: job.id, rounds: rounds.length, messageId }, 'investigate: concluído e entregue no thread');
  };
}

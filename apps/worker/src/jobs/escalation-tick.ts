import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { sendTeamMessage, type TelegramConfig } from '@luna/channels';
import { recordAudit, recordActivity } from '@luna/database';

/**
 * Escalação avançada (contrato §18 + ADR-025) — tick periódico no worker:
 *
 * 1. SLA por prioridade: CRÍTICA 5min / ALTA 10min (NORMAL=mensagem, BAIXA=cola
 *    — sem timer). Escalção notificada e não atendida no SLA → follow-up de
 *    degrau (re-alert ao time com contexto), uma vez.
 * 2. Coordenação consciente: humano que atende SOME no meio (15min sem
 *    atividade dele com cliente falando) → cascata RETOMA de onde parou
 *    (re-alert com contexto preservado) — jamás do zero.
 */

export const SLA_MINUTES: Record<string, number> = { CRITICA: 5, ALTA: 10 };
export const HUMAN_SILENCE_MINUTES = 15;

export interface EscalationTickDeps {
  pool: Pool;
  log: Logger;
  telegram?: TelegramConfig;
}

interface EscalationRow {
  id: string;
  client_id: string | null;
  conversation_id: string | null;
  reason: string;
  priority: string;
  handled_by: string | null;
}

async function alert(deps: EscalationTickDeps, text: string): Promise<void> {
  if (deps.telegram?.botToken && deps.telegram.teamChatId) {
    try {
      await sendTeamMessage(text, deps.telegram);
      return;
    } catch (err) {
      deps.log.error({ err }, 'escalation tick: alerta Telegram falhou');
    }
  }
  deps.log.error({ text }, 'escalation tick: TELEGRAM não configurado — alerta NÃO enviado (falha explícita registrada)');
}

/** Um ciclo de checagem. Retorna o que fez (pra testes/observabilidade). */
export async function runEscalationTick(deps: EscalationTickDeps): Promise<{
  followUps: number;
  cascadesResumed: number;
}> {
  const { pool } = deps;
  let followUps = 0;
  let cascadesResumed = 0;

  // 1) SLA: CRÍTICA/ALTA notificadas e não atendidas.
  const due = await pool.query<EscalationRow>(
    `SELECT id, client_id, conversation_id, reason, priority
     FROM escalations
     WHERE status = 'notified' AND followed_up = false
       AND priority IN ('CRITICA', 'ALTA')
       AND notified_at < now() - make_interval(mins => (CASE priority WHEN 'CRITICA' THEN $1 ELSE $2 END)::int)`,
    [SLA_MINUTES.CRITICA, SLA_MINUTES.ALTA],
  );
  for (const esc of due.rows) {
    await pool.query(
      `UPDATE escalations SET followed_up = true, updated_at = now() WHERE id = $1`,
      [esc.id],
    );
    await recordAudit(pool, {
      actor: 'worker',
      action: 'escalation.followup_sent',
      tool: 'escalation_tick',
      client_id: esc.client_id,
      result: 'success',
      metadata: { escalation_id: esc.id, priority: esc.priority, sla_min: SLA_MINUTES[esc.priority] },
    });
    await alert(
      deps,
      `⏰ Escalación ${esc.priority} sem atendimento (${SLA_MINUTES[esc.priority]}min): ${esc.reason}. ` +
        `Quem puder pega — contexto completo na escalation ${esc.id.slice(0, 8)}. 🙏`,
    );
    followUps++;
  }

  // 2) Humano que atendeu SUMIU: sem atividade dele + cliente falando.
  const gone = await pool.query<EscalationRow & { conversation_id: string }>(
    `SELECT e.id, e.client_id, e.conversation_id, e.reason, e.priority, e.handled_by
     FROM escalations e
     WHERE e.status = 'handling'
       AND e.last_handled_at < now() - make_interval(mins => $1)
       AND EXISTS (
         SELECT 1 FROM messages m
         WHERE m.conversation_id = e.conversation_id AND m.direction = 'inbound'
           AND m.created_at > e.last_handled_at
       )`,
    [HUMAN_SILENCE_MINUTES],
  );
  for (const esc of gone.rows) {
    await pool.query(
      `UPDATE escalations SET status = 'followed_up', followed_up = true, updated_at = now() WHERE id = $1`,
      [esc.id],
    );
    await recordAudit(pool, {
      actor: 'worker',
      action: 'escalation.cascade.resumed',
      tool: 'escalation_tick',
      client_id: esc.client_id,
      result: 'success',
      metadata: {
        escalation_id: esc.id,
        handled_by: esc.handled_by,
        motivo: `${HUMAN_SILENCE_MINUTES}min sem atividade com cliente ativo — cascata retoma`,
      },
    });
    await recordActivity(pool, {
      client_id: esc.client_id,
      kind: 'incident',
      summary: `Cascata de escalación retomada: ${esc.handled_by} parou de responder e o cliente continua falando (contexto preservado).`,
    });
    await alert(
      deps,
      `🔁 Cascata retomada: ${esc.handled_by ?? 'humano'} parou de responder mas o cliente continua ativo.\n` +
        `Caso: ${esc.reason}. Contexto preservado na escalation — continua de onde parou.`,
    );
    cascadesResumed++;
  }

  return { followUps, cascadesResumed };
}

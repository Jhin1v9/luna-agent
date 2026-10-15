import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { sendTeamMessage, type TelegramConfig } from '@luna/channels';
import { recordAudit, recordActivity, alertOwnerWhatsApp, enqueueJob } from '@luna/database';

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

async function alert(deps: EscalationTickDeps, text: string, esc?: { id: string; priority?: string; stage?: string }): Promise<void> {
  if (deps.telegram?.botToken && deps.telegram.teamChatId) {
    try {
      await sendTeamMessage(text, deps.telegram);
      return;
    } catch (err) {
      deps.log.error({ err }, 'escalation tick: alerta Telegram falhou');
    }
  }
  // 2026-10-14 (decreto owner): Telegram do time NUNCA configurado = ninguém
  // recebia escalation. Canal real agora é o WhatsApp do owner (DM da Luna
  // pro Abner) — TODO alerta duplica pra lá, gravado em messages + audit.
  const wa = await alertOwnerWhatsApp(deps.pool, text, {
    escalation_id: esc?.id ?? 'unknown',
    priority: esc?.priority,
    stage: esc?.stage ?? 'tick',
  });
  if (wa.ok) {
    deps.log.info({ escalation_id: esc?.id }, 'escalation tick: alerta enviado no WhatsApp do owner');
  } else {
    deps.log.error({ err: wa.error }, 'escalation tick: alerta WhatsApp do owner FALHOU');
  }
}

/** Delay após o follow-up de SLA antes de LIGAR pro owner (minutos). */
export const VOICE_CALL_AFTER_FOLLOWUP_MINUTES = 5;

/** Inatividade que expira uma escalation (minutos) — espelha o handler. */
export const STALE_ESCALATION_MINUTES = 45;

/** Um ciclo de checagem. Retorna o que fez (pra testes/observabilidade). */
export async function runEscalationTick(deps: EscalationTickDeps): Promise<{
  followUps: number;
  cascadesResumed: number;
  voiceCalls: number;
}> {
  const { pool } = deps;
  let followUps = 0;
  let cascadesResumed = 0;
  let voiceCalls = 0;

  // 0) EXPIRAÇÃO (decreto owner 14/10): escalation 'notified' sem atividade
  //    humana por 45min expira — a Luna volta a responder sozinha. Sem isso,
  //    escalation antiga acumula stages (follow-up + ligação) de uma vez só
  //    (misfire real no boot 17:10). Espelha ESCALATION_STALE_MS do handler.
  const expired = await pool.query<{ id: string; client_id: string | null }>(
    `UPDATE escalations SET status = 'expired', updated_at = now()
     WHERE status IN ('notified','handling')
       AND COALESCE(last_handled_at, notified_at, created_at) < now() - make_interval(mins => $1)
     RETURNING id, client_id`,
    [STALE_ESCALATION_MINUTES],
  );
  for (const e of expired.rows) {
    await recordAudit(pool, {
      actor: 'worker',
      action: 'escalation.auto_expired',
      tool: 'escalation_tick',
      client_id: e.client_id,
      result: 'success',
      metadata: { escalation_id: e.id, stale_min: STALE_ESCALATION_MINUTES, origin: 'tick' },
    });
  }
  if (expired.rowCount) deps.log.info({ expired: expired.rowCount }, 'escalation tick: escalations expiradas por inatividade');

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
      `🚨 Escalation ${esc.priority} sem atendimento há ${SLA_MINUTES[esc.priority]}min\n` +
        `Caso: ${esc.reason}\n` +
        `Ninguém do time respondeu. Me manda um "ok" aqui ou resolve no painel — ` +
        `se continuar sem resposta eu TE LIGO. (escalation ${esc.id.slice(0, 8)})`,
      { id: esc.id, priority: esc.priority, stage: 'sla_followup' },
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
      { id: esc.id, priority: esc.priority, stage: 'cascade_resume' },
    );
    cascadesResumed++;
  }

  // 3) REGRA OWNER 14/10 — insistência: escalation segue sem atendimento
  //    após o follow-up de SLA → a Luna LIGA pro owner (voz) com o prompt
  //    montado do contexto da escalation. Uma vez (metadata voice_call_placed).
  const callDue = await pool.query<EscalationRow & { metadata: Record<string, unknown> | null; conversation_id: string }>(
    `SELECT id, client_id, conversation_id, reason, priority, handled_by, metadata
     FROM escalations
     WHERE status = 'notified' AND followed_up = true
       AND priority IN ('CRITICA','ALTA')
       AND (metadata->>'voice_call_placed') IS NULL
       AND updated_at < now() - make_interval(mins => $1)
       AND created_at > now() - interval '1 hour'`,
    [VOICE_CALL_AFTER_FOLLOWUP_MINUTES],
  );
  // v15: contato administrativo configurável por env (LUNA_ESCALATION_CONTACT,
  // fallback legado SUPERCLIM_*). Sem default pessoal (decreto owner 15/10:
  // infos internas ficam em cada repo) — sem env, falha fechado.
  const escalationContact =
    process.env.LUNA_ESCALATION_CONTACT?.trim() ||
    process.env.SUPERCLIM_ESCALATION_CONTACT?.trim() ||
    '';
  if (!escalationContact) {
    if (callDue.rowCount) deps.log.warn({ pendentes: callDue.rowCount }, 'escalação sem contato administrativo cadastrado; chamada automática não criada');
  }
  for (const esc of escalationContact ? callDue.rows : []) {
    // Contexto do prompt: últimas falas do cliente na conversa da escalation.
    const recent = await pool.query<{ body: string; author_name: string | null }>(
      `SELECT body, author_name FROM messages
       WHERE conversation_id = $1 AND direction = 'inbound'
       ORDER BY created_at DESC LIMIT 3`,
      [esc.conversation_id],
    );
    const falas = recent.rows
      .reverse()
      .map((m) => `${m.author_name ?? 'cliente'}: ${m.body.slice(0, 220)}`)
      .join(' | ');
    const brief = {
      destinatario: escalationContact,
      autorizador: 'política Superclim (contato administrativo configurado)',
      motivo: `Escalation ${esc.priority} sem atendimento: ${esc.reason}`.slice(0, 300),
      objetivo:
        `Você está ligando para o contato administrativo cadastrado. Uma escalation ${esc.priority} ficou sem atendimento: ${esc.reason}. ` +
        `Contexto recente do cliente: ${falas || '(sem falas recentes)'.slice(0, 400)}. ` +
        `Peça uma decisão rápida ou que ele responda no chat. Se ele atender, resume o caso e pergunta pra quem ele delega.`,
    };
    await enqueueJob(pool, {
      job_type: 'voice.call',
      payload: { brief },
      priority: 8,
      max_attempts: 1,
      idempotency_key: `voice_call_esc:${esc.id}`,
    });
    await pool.query(
      `UPDATE escalations SET metadata = metadata || $2::jsonb, updated_at = now() WHERE id = $1`,
      [esc.id, JSON.stringify({ voice_call_placed: new Date().toISOString() })],
    );
    await recordAudit(pool, {
      actor: 'worker',
      action: 'escalation.voice_call_dispatched',
      tool: 'escalation_tick',
      client_id: esc.client_id,
      result: 'success',
      metadata: { escalation_id: esc.id, priority: esc.priority, to: escalationContact },
    });
    await alert(
      deps,
      `📞 ${esc.handled_by ? '' : 'Ninguém atendeu — '}tô LIGANDO pra você agora sobre a escalation ${esc.priority}: ${esc.reason}`,
      { id: esc.id, priority: esc.priority, stage: 'voice_call' },
    );
    voiceCalls++;
  }

  return { followUps, cascadesResumed, voiceCalls };
}

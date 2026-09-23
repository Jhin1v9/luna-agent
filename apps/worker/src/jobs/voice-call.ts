import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { publishEvent } from '@luna/database';
import type { JobHandler } from './poller.js';

/**
 * Job voice.call (decreto owner: fast brain liga por intenção estruturada):
 * publica voice.call.requested + pg_notify('voice_call_requests') — o daemon
 * do whatsplay (dono do Chrome) escuta e executa o fluxo de chamada
 * (pré-voo + placeVoiceCall + conductora). O worker NÃO liga (não tem Chrome).
 */
export function createVoiceCallHandler(deps: { pool: Pool; log: Logger }): JobHandler {
  return async function voiceCall(job): Promise<void> {
    const payload = job.payload as { brief?: unknown };
    const { event } = await publishEvent(deps.pool, {
      event_type: 'voice.call.requested',
      source: 'worker',
      payload: payload.brief && typeof payload.brief === 'object' ? (payload.brief as Record<string, unknown>) : {},
      idempotency_key: `voice_call:${job.id}`,
    });
    await deps.pool.query('SELECT pg_notify($1, $2)', ['voice_call_requests', event.event_id]);
    deps.log.info({ job: job.id, event_id: event.event_id }, 'voice.call: evento publicado — daemon do whatsplay executa');
  };
}

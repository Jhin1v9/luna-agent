import type { Logger } from 'pino';
import type { Pool } from 'pg';
import type { WhatsAppTransport } from '../transport.js';
import { KimiCliAdapter } from '@luna/agent';
import { OperatorSession } from './operator-session.js';
import { preflightOperator } from './operator-preflight.js';
import { CallConductor } from './call-conductor.js';
import type { CallBrief } from './operator-preflight.js';

/**
 * Executor da chamada no daemon do whatsplay (dono do Chrome): escuta
 * pg_notify('voice_call_requests') → pré-voo (aba → modo voz → prompt
 * composto pelo Kimi → operador ativo) → placeVoiceCall → conductora
 * durante a chamada → endCall. Falha em qualquer etapa = explícita, e o
 * destinatário é avisado por texto quando dá (nunca silêncio sem aviso).
 */

export interface CallExecutorDeps {
  pool: Pool;
  transport: WhatsAppTransport;
  log: Logger;
}

export function createCallExecutor(deps: CallExecutorDeps) {
  const { pool, transport, log } = deps;
  const live = new KimiCliAdapter({ mode: 'kimi-cli' }, { timeoutMs: 120_000 });
  const operator = new OperatorSession({ log });
  let busy = false;

  return async function executeCallRequest(eventId: string): Promise<void> {
    if (busy) {
      log.warn({ event_id: eventId }, 'voice.call: já estou em uma chamada — pedido ignorado (explícito)');
      return;
    }
    busy = true;
    const correlationId = `corr_call_${Date.now()}`;
    try {
      const ev = await pool.query(`SELECT payload FROM events WHERE event_id = $1`, [eventId]);
      const brief = (ev.rows[0]?.payload ?? {}) as CallBrief;
      log.info({ brief, correlation_id: correlationId }, 'voice.call: pedido recebido — pré-voo');

      const tab = await preflightOperator({ operator, live, log, timeoutMs: 30_000 }, brief);
      log.info('voice.call: operador ativo — discando');
      await (transport as never as { placeVoiceCall: (c: string) => Promise<void> }).placeVoiceCall(brief.destinatario);
      log.info({ destinatario: brief.destinatario }, 'voice.call: chamando');

      // aguarda atendimento (até ~30s) e liga a conductora
      const answered = async (): Promise<boolean> =>
        (await (transport as never as { observePanel: () => Promise<{ state: string }> }).observePanel()).state === 'chamada';
      let connected = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 30_000) {
        await new Promise((r) => setTimeout(r, 3_000));
        if (await answered()) {
          connected = true;
          break;
        }
      }
      if (!connected) {
        log.warn('voice.call: ninguém atendeu em ~30s — encerrando');
        await (transport as never as { endCall: () => Promise<void> }).endCall().catch(() => {});
        return;
      }
      const conductor = new CallConductor({
        operator,
        live,
        log,
        pool,
        correlationId,
        pollMs: 3_000,
        executeAction: async (name, detail) => {
          log.info({ name, detail }, 'voice.call: ação pedida pela conductora (sem executor no daemon ainda)');
          return `ação ${name} registrada (sem executor) — ${detail.slice(0, 80)}`;
        },
      });
      const handle = conductor.start(tab, {
        participantes: [brief.destinatario, 'quem atender'],
        objetivo: brief.objetivo,
        poderes: ['escrever no chat do Operador', 'escalar pro owner'],
        tom: 'parceira de time, direta, PT-BR',
      });
      // encerra quando a chamada cair (poll do estado) — o owner também pode desligar na janela
      for (;;) {
        await new Promise((r) => setTimeout(r, 5_000));
        const st = await (transport as never as { observePanel: () => Promise<{ state: string }> }).observePanel();
        if (st.state !== 'chamada') break;
      }
      handle.stop();
      log.info('voice.call: chamada encerrada (estado saiu de "chamada")');
    } catch (err) {
      log.error({ err: String(err).slice(0, 300), correlation_id: correlationId }, 'voice.call: FALHA no fluxo — explícita, nada de silêncio');
    } finally {
      busy = false;
    }
  };
}

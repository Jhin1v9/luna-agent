import type { Logger } from 'pino';
import type { Pool } from 'pg';
import type { WhatsAppTransport } from '../transport.js';
import { FallbackAdapter, KimiWorkAdapter } from '@luna/agent';
import type { KimiLiveAdapter } from '@luna/agent';
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
 *
 * Cérebro das chamadas (2026-09-23): FallbackAdapter ADR-039 — Kimi API
 * primária, Gemini na reserva. Antes era KimiCliAdapter puro: quota do
 * CLI morta = TODA chamada abortava no pré-voo. Mesmo decreto do
 * orchestrator: kimi first, fallback explícito no log.
 */

export interface CallExecutorDeps {
  pool: Pool;
  transport: WhatsAppTransport;
  log: Logger;
}

/**
 * Cérebro das chamadas (2026-09-23): FallbackAdapter ADR-039 — Kimi API
 * primária, Gemini na reserva. Antes era KimiCliAdapter puro: quota do
 * CLI morta = TODA chamada abortava no pré-voo. Mesmo decreto do
 * orchestrator: kimi first, fallback explícito no log.
 * ADR-040: com KIMI_ADAPTER_MODE=kimiwork, a composição do prompt do
 * Operador também vai pra Luna do Kimi Work (mesma fila, mesmo pool).
 * Exportado pra reuso no fast path de chamadas RECEBIDAS (incoming-fastpath).
 */
export function createVoiceLiveAdapter(pool: Pool, log: Logger): KimiLiveAdapter {
  return process.env.KIMI_ADAPTER_MODE === 'kimiwork'
    ? new KimiWorkAdapter(
        { mode: 'kimiwork' },
        {
          pool,
          timeoutMs: Number(process.env.KIMIWORK_LLM_TIMEOUT_MS ?? 120_000),
          pollIntervalMs: Number(process.env.KIMIWORK_LLM_POLL_MS ?? 2_500),
        },
      )
    : new FallbackAdapter(
        {
          mode: 'kimi-api',
          apiKey: process.env.LLM_API_KEY,
          apiBaseUrl: process.env.LLM_BASE_URL,
          apiModel: process.env.LLM_MODEL,
          fallbackApiKey: process.env.GEMINI_API_KEY,
          fallbackBaseUrl: process.env.GEMINI_BASE_URL,
          fallbackModel: process.env.GEMINI_MODEL,
        },
        undefined,
        { onFallback: ({ from, to, reason }) => log.warn({ from, to, reason: reason.slice(0, 160) }, `voice.call: fallback ${from}→${to}`) },
      );
}

export function createCallExecutor(deps: CallExecutorDeps) {
  const { pool, transport, log } = deps;
  const live = createVoiceLiveAdapter(pool, log);
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
      const stored = (ev.rows[0]?.payload ?? {}) as Record<string, unknown>;
      // publishEvent grava o ENVELOPE INTEIRO na coluna payload — o brief
      // (CallBrief) fica em stored.payload. Defesa em profundidade: aceita
      // também o bare payload (se destinatário estiver na raiz). Evidência
      // ao vivo 2026-09-23: discou pra 'undefined' e crashou no .includes.
      const inner = stored && typeof stored === 'object' && 'payload' in stored ? (stored.payload ?? {}) : stored;
      const brief = inner as CallBrief;
      if (!brief.destinatario) throw new Error('voice.call: evento sem destinatário — ABORTO (envelope malformado)');
      // CONTENÇÃO P0 (incidente 2026-09-23) + FIX DEFINITIVO (Chat Registry,
      // migração 012): ligação só sai com VOICE_CALL_ENABLED=true E alvo
      // RESOLVIDO pelo registry. Blocked = recusa eterna; fora do registry =
      // recusa + pede registro (fail-closed). O nome canônico do registro é a
      // única fonte — nunca mais nome solto decidindo destino.
      if (process.env.VOICE_CALL_ENABLED !== 'true') {
        throw new Error(`voice.call DESLIGADO (contenção pós-incidente 2026-09-23, VOICE_CALL_ENABLED≠true) — pedido para '${brief.destinatario}' recusado`);
      }
      const { registryCheck } = await import('@luna/database');
      const decision = await registryCheck(pool, brief.destinatario, 'ligar');
      if (!decision.ok) {
        log.error({ destinatario: brief.destinatario, reason: decision.reason }, 'voice.call: recusado pelo Chat Registry');
        throw new Error(`voice.call: ${decision.reason}`);
      }
      log.info(
        { destinatario: decision.entry.canonicalName, chat_key: decision.entry.chatKey, kind: decision.entry.kind, correlation_id: correlationId },
        'voice.call: destino resolvido pelo Chat Registry',
      );
      brief.destinatario = decision.entry.canonicalName;
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

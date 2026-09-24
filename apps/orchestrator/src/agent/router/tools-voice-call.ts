import type { Sql } from '@luna/database';
import { enqueueJob } from '@luna/database';
import type { FastTool, ToolContext, ToolResult } from './tools.js';

/**
 * Tool voice.call_place (decreto owner: "lembra de lembrar o fast luna que
 * ela pode fazer ligar") — o FAST emite a INTENÇÃO; quem executa é o caminho
 * de jobs: job `voice.call` → worker publica voice.call.requested +
 * pg_notify('voice_call_requests') → o daemon do whatsplay (dono do Chrome)
 * executa pré-voo + placeVoiceCall + conductora. A tool NUNCA liga direto —
 * enfileira e devolve o que vai acontecer.
 */

export function createVoiceCallTool(db: Sql): FastTool {
  return async (_db: Sql, ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    // CONTENÇÃO P0 (incidente 2026-09-23: chamada foi parar em contato fora do
    // escopo porque o destino era nome solto, sem identidade verificada).
    // Liga só com VOICE_CALL_ENABLED=true no .env E alvo RESOLVIDO pelo
    // Chat Registry (deny-first, fail-closed — migração 012).
    if (process.env.VOICE_CALL_ENABLED !== 'true') {
      return {
        ok: false,
        data: null,
        error: 'voice.call_place DESLIGADO (contenção pós-incidente 2026-09-23: alvo sem identidade verificada). Aguardando Chat Registry.',
      };
    }
    const contato = String(args.contato ?? '').trim();
    if (!contato) return { ok: false, data: null, error: 'voice.call_place: arg "contato" é obrigatório' };
    // Chat Registry — deny-first: blocked = nunca; fora do registry = recusa +
    // pede registro (fail-closed). A tool NUNCA enfileira destino sem
    // identidade resolvida (incidente 2026-09-23).
    const { registryCheck } = await import('@luna/database');
    const decision = await registryCheck(db, contato, 'ligar');
    if (!decision.ok) {
      return { ok: false, data: null, error: `voice.call_place: ${decision.reason}` };
    }
    const alvo = decision.entry.canonicalName;
    const motivo = String(args.motivo ?? 'chamada solicitada pela Luna (fast brain)').trim();
    const objetivo = String(args.objetivo ?? motivo).trim();
    const idem = `voicecall:${alvo}:${new Date().toISOString().slice(0, 13)}`;
    try {
      const job = await enqueueJob(db, {
        job_type: 'voice.call',
        payload: {
          brief: {
            destinatario: alvo,
            chat_key: decision.entry.chatKey,
            autorizador: 'fast-brain',
            motivo,
            objetivo,
          },
          conversation_id: ctx.conversationId,
          client_id: ctx.clientId,
        },
        priority: 8,
        max_attempts: 1,
        idempotency_key: idem,
      });
      return {
        ok: true,
        data: {
          enfileirado: true,
          job_id: job.id,
          duplicado: !job.created,
          destino: { nome: alvo, chat_key: decision.entry.chatKey },
          mensagem: `Chamada de voz para '${alvo}' (identidade verificada no Chat Registry) enfileirada — o sistema vai fazer o pré-voo (operador ativo) e discar.`,
        },
      };
    } catch (err) {
      return { ok: false, data: null, error: `voice.call_place: falha ao enfileirar (${String(err).slice(0, 150)})` };
    }
  };
}

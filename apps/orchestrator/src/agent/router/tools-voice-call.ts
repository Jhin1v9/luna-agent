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
    // escopo porque o destino era nome solto, sem identidade verificada). A
    // tool fica DESLIGADA por padrão até o Chat Registry existir
    // (identidade por número + blocklist deny-first). Liga de novo só com
    // VOICE_CALL_ENABLED=true no .env — e mesmo assim o alvo passa pela
    // outbound allowlist abaixo.
    if (process.env.VOICE_CALL_ENABLED !== 'true') {
      return {
        ok: false,
        data: null,
        error: 'voice.call_place DESLIGADO (contenção pós-incidente 2026-09-23: alvo sem identidade verificada). Aguardando Chat Registry.',
      };
    }
    const contato = String(args.contato ?? '').trim();
    if (!contato) return { ok: false, data: null, error: 'voice.call_place: arg "contato" é obrigatório' };
    // Contenção mínima de escopo: alvo tem que estar na outbound allowlist
    // (match exato por nome/jid — as mesmas regras do whatsplay). O Chat
    // Registry substituirá isso por identidade por número.
    const lista = (process.env.WHATSAPP_OUTBOUND_ALLOWLIST ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (lista.length > 0 && !lista.includes(contato)) {
      return {
        ok: false,
        data: null,
        error: `voice.call_place: '${contato}' fora da outbound allowlist (${lista.join(', ')}) — recusado`,
      };
    }
    const motivo = String(args.motivo ?? 'chamada solicitada pela Luna (fast brain)').trim();
    const objetivo = String(args.objetivo ?? motivo).trim();
    const idem = `voicecall:${contato}:${new Date().toISOString().slice(0, 13)}`;
    try {
      const job = await enqueueJob(db, {
        job_type: 'voice.call',
        payload: {
          brief: {
            destinatario: contato,
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
          mensagem: `Chamada de voz para '${contato}' enfileirada — o sistema vai fazer o pré-voo (operador ativo) e discar.`,
        },
      };
    } catch (err) {
      return { ok: false, data: null, error: `voice.call_place: falha ao enfileirar (${String(err).slice(0, 150)})` };
    }
  };
}

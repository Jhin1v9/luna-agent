import { z } from 'zod';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { KimiLiveAdapter } from '@luna/agent';
import { recordAudit, type Sql } from '@luna/database';
import { appendClientOpinion, appendSynapse, BRAIN_ROOT } from '@luna/brain';

/**
 * Classifier pós-conversa (§27, refinado pela pesquisa — ADR-026): ao
 * RESOLVED, o worker classifica a conversa com o FAST (JSON estruturado):
 * outcome, sentiment, topic, product, urgency, follow_up_required, summary,
 * quality_score. Grava em conversations.classification, acumula sinais em
 * clients.profile, append no Brain (OPINIONES do cliente + sinapse) e
 * memory_index. Taxonomia PEQUENA e fixa — generalista superestima nuance
 * quando o schema é amplo; 5-12 labels distintas com exemplos.
 */

export const classificationSchema = z.object({
  outcome: z.enum(['resuelto', 'cliente_feliz', 'queria_mejora', 'sugestao', 'reclamacao', 'outro']),
  sentiment: z.enum(['positivo', 'neutro', 'negativo']),
  topic: z.enum([
    'site', 'design', 'conteudo', 'dominio_hospedagem', 'financeiro',
    'prazo', 'suporte_tecnico', 'pedido_novo', 'outro',
  ]),
  product: z.string().default(''),       // projeto/serviço mencionado
  urgency: z.enum(['baixa', 'normal', 'alta', 'critica']),
  follow_up_required: z.boolean().default(false),
  follow_up_note: z.string().default(''),
  quality_score: z.number().int().min(1).max(5), // qualidade da resposta da Luna
  summary: z.string().min(5),            // 1-2 frases, linguagem do time
  client_signal: z.enum(['pedido', 'reclamacao_recorrente', 'elogio', 'duvida', 'nenhum']),
});

export type ConversationClassification = z.infer<typeof classificationSchema>;

const CLASSIFY_PROMPT = (clientName: string, transcript: string) =>
  [
    'Você é a Luna classificando uma conversa de atendimento ENCERRADA da Nexo Digital.',
    `Cliente: ${clientName}.`,
    'Responda APENAS o JSON da classificação, sem texto fora.',
    '',
    'Taxonomia: outcome = resuelto|cliente_feliz|queria_mejora|sugestao|reclamacao|outro;',
    'sentiment = positivo|neutro|negativo; topic = site|design|conteudo|dominio_hospedagem|',
    'financeiro|prazo|suporte_tecnico|pedido_novo|outro; urgency = baixa|normal|alta|critica;',
    'quality_score 1-5 (a resposta da Luna foi boa?); client_signal = pedido|',
    'reclamacao_recorrente|elogio|duvida|nenhum (sinal de negócio).',
    '',
    'Contexto (leia ao vivo pela tool; amostra minima abaixo):',
    transcript.slice(0, 3000),
    '',
    'Exemplo: {"outcome":"cliente_feliz","sentiment":"positivo","topic":"site",',
    '"product":"site da Jess","urgency":"baixa","follow_up_required":false,',
    '"follow_up_note":"","quality_score":5,"summary":"Cliente aprovou o hero novo.",',
    '"client_signal":"elogio"}',
  ].join('\n');

export interface ClassifyDeps {
  pool: Pool;
  adapter: KimiLiveAdapter;
  log: Logger;
  brainRoot?: string;
}

export function createClassifyHandler(deps: ClassifyDeps) {
  const { pool, adapter, log } = deps;
  const brainRoot = deps.brainRoot ?? BRAIN_ROOT;

  return async function classifyConversation(job: {
    payload: { conversation_id?: string; client_id?: string | null; correlation_id?: string };
  }): Promise<void> {
    const conversationId = job.payload.conversation_id;
    if (!conversationId) throw new Error('conversation.classify sem conversation_id');

    const conv = await pool.query<{ client_id: string | null; client_name: string | null; client_code: string | null }>(
      `SELECT c.client_id, cl.name AS client_name, cl.code AS client_code
       FROM conversations c LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = $1`,
      [conversationId],
    );
    if (!conv.rowCount) throw new Error(`conversa ${conversationId} não existe`);
    const { client_id, client_name, client_code } = conv.rows[0]!;

    const msgs = await pool.query<{ author_name: string | null; direction: string; body: string }>(
      `SELECT author_name, direction, body FROM messages
       WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 8`,
      [conversationId],
    );
    if (!msgs.rowCount || msgs.rowCount < 2) return; // sem conversa de verdade, nada a classificar

    // v16.11-fix (owner 20/10): o modelo LE o chat ao vivo via
    // dashboardGetWhatsAppHistory e classifica pelo que leu. A amostra
    // (ultimas 8, ordem cronologica) e so cinto-e-suspensorio.
    const recentSample = msgs.rows.slice().reverse()
      .map((m) => `${m.author_name ?? (m.direction === 'inbound' ? 'cliente' : 'Luna')}: ${m.body}`)
      .join('\n');
    const transcript = 'INSTRUCAO: antes de classificar, LEIA as mensagens recentes deste chat ao vivo usando a tool dashboardGetWhatsAppHistory (parametro chat = o nome desta conversa). Classifique com base no que voce LEU. Amostra minima das ultimas 8 mensagens (use so se a tool falhar):\n' + recentSample;

    const turn = await adapter.sendTurn({
      session_key: `classify:${conversationId}`,
      prompt: CLASSIFY_PROMPT(client_name ?? 'desconhecido', transcript),
    });

    let parsed: ConversationClassification;
    try {
      const candidate = turn.reply_text.match(/\{[\s\S]*\}/)?.[0] ?? turn.reply_text;
      parsed = classificationSchema.parse(JSON.parse(candidate));
    } catch (err) {
      await recordAudit(pool, {
        actor: 'worker',
        action: 'conversation.classify_failed',
        tool: 'classifier',
        client_id,
        result: 'failed',
        metadata: { conversation_id: conversationId, error: String(err).slice(0, 200) },
      });
      log.error({ err, conversation_id: conversationId }, 'classifier: parse falhou (fail-closed registrado)');
      return; // falha explícita auditada; não derruba o job de verdade
    }

    await pool.query('UPDATE conversations SET classification = $2, updated_at = now() WHERE id = $1', [
      conversationId,
      parsed,
    ]);

    // clients.profile: acumula sinais de negócio (info rica sobre o cliente).
    await pool.query(
      `UPDATE clients SET profile = profile || $2::jsonb, updated_at = now() WHERE id = $1`,
      [
        client_id,
        JSON.stringify({
          last_outcome: parsed.outcome,
          last_topic: parsed.topic,
          signals: { [parsed.client_signal]: true },
          last_summary: parsed.summary,
          classified_at: new Date().toISOString(),
        }),
      ],
    );

    // Brain: OPINIONES do cliente + memory_index + sinapse.
    if (client_code) {
      appendClientOpinion(
        client_code,
        { summary: parsed.summary, classification: parsed as Record<string, unknown> },
        brainRoot,
      );
      await pool.query(
        `INSERT INTO memory_index (client_id, type, path, tags, summary)
         VALUES ($1, 'opinion', $2, $3, $4)`,
        [client_id, `.brain/clients/${client_code}/OPINIONES.md`, [parsed.topic, parsed.outcome], parsed.summary],
      );
    }
    appendSynapse(
      {
        commit: 'classifier',
        summary: `conversa classificada: ${parsed.outcome}/${parsed.topic} (${client_name ?? '?'}): ${parsed.summary}`.slice(0, 160),
        correlation_id: job.payload.correlation_id ?? null,
      },
      brainRoot,
    );

    await recordAudit(pool, {
      actor: 'worker',
      action: 'conversation.classified',
      tool: 'classifier',
      client_id,
      correlation_id: job.payload.correlation_id ?? null,
      result: 'success',
      metadata: { conversation_id: conversationId, outcome: parsed.outcome, topic: parsed.topic, urgency: parsed.urgency, follow_up_required: parsed.follow_up_required },
    });
    log.info({ conversation_id: conversationId, outcome: parsed.outcome }, 'classifier: conversa classificada (§27)');
  };
}

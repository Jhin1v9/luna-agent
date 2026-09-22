import { z } from 'zod';
import { extractAnswerEnvelopeText } from '@luna/shared';

/**
 * Saídas estruturadas do FAST (contrato §5) — todo turno devolve um objeto
 * com `type`. Guardas de bucle em router.ts (§5.1).
 */

export const STRUCTURED_INSTRUCTIONS = [
  'Você é a Luna operando com SAÍDA ESTRUTURADA. Responda APENAS um JSON válido,',
  'sem texto fora do JSON, com exatamente uma destas formas:',
  '',
  '{"type":"ANSWER","text":"texto para o cliente/canal"}',
  '{"type":"TOOL_CALL","tool":"nome_da_tool","args":{...},"reason":"por que"}',
  '{"type":"HANDOFF_LIVE","objective":"o que investigar","context_summary":"o que já sabe"}',
  '{"type":"ESCALATE_HUMAN","reason":"motivo","priority":"CRITICA|ALTA|NORMAL|BAJA","summary":"resumo"}',
  '',
  'Regras: use TOOL_CALL só se precisar de dado que não tem; se a premissa do',
  'cliente estiver errada, ISSO É SUCESSO — responda ANSWER corrigindo com',
  'educação, sem gastar mais chamadas. Se não tiver certeza de preço, prazo ou',
  'status, NUNCA invente: HANDOFF_LIVE ou ESCALATE_HUMAN.',
].join('\n');

const baseFields = { type: z.string(), _note: z.string().optional() };

export const structuredOutputSchema = z.discriminatedUnion('type', [
  z.object({ ...baseFields, type: z.literal('ANSWER'), text: z.string().min(1) }),
  z.object({
    ...baseFields,
    type: z.literal('TOOL_CALL'),
    tool: z.string().min(1),
    args: z.record(z.unknown()).default({}),
    reason: z.string().default(''),
  }),
  z.object({
    ...baseFields,
    type: z.literal('HANDOFF_LIVE'),
    objective: z.string().min(1),
    context_summary: z.string().default(''),
  }),
  z.object({
    ...baseFields,
    type: z.literal('ESCALATE_HUMAN'),
    reason: z.string().min(1),
    priority: z.enum(['CRITICA', 'ALTA', 'NORMAL', 'BAJA']).default('NORMAL'),
    summary: z.string().default(''),
  }),
]);

export type StructuredOutput = z.infer<typeof structuredOutputSchema>;

/**
 * Parse tolerante: o FAST às vezes embrulha o JSON em prosa. Se nada servir,
 * DEGRADA para ANSWER com o texto cru — nunca se perde a mensagem do cliente
 * por causa de parse (decisão registrada: fallback é ANSWER, não escalada).
 */
export function parseStructured(raw: string): { output: StructuredOutput; degraded: boolean } {
  const candidate = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
  try {
    const parsed = structuredOutputSchema.parse(JSON.parse(candidate));
    return { output: parsed, degraded: candidate !== raw.trim() };
  } catch {
    // JSON estrito quebrou (bug ao vivo: newline literal dentro de "text").
    // Antes de degradar pro texto cru, tenta salvar o envelope ANSWER — senão
    // o cliente receberia o JSON literal no canal.
    const salvaged = extractAnswerEnvelopeText(raw);
    if (salvaged !== null) return { output: { type: 'ANSWER', text: salvaged }, degraded: true };
    return { output: { type: 'ANSWER', text: raw.trim() }, degraded: true };
  }
}

/** §8.1: pedido explícito de humano = escalación IMEDIATA, zero tentativas de IA. */
const HUMAN_REQUEST_RE =
  /me liga|me ligue|liga pra mim|quero falar com (algu[eé]m|um humano|uma pessoa|atendente|gente)|falar com atendente|chama (o|a|um) (atendente|humano)|preciso de (um )?humano|atendente humano/i;

export function isExplicitHumanRequest(text: string): boolean {
  return HUMAN_REQUEST_RE.test(text);
}

/**
 * Scoring de golden conversations (§29) — função PURA (CI-friendly, sem rede,
 * sem token). O runner com LLM real (tools-run-evals.ts) usa esta mesma função;
 * o teste de CI injeta respostas determinísticas.
 */

export interface Golden {
  id: string;
  input: { de: string; pergunta: string };
  respostaReal: string;
  expect: { idioma: string; mencionarAutorPeloNome: boolean; nuncaInventarDado: boolean };
}

export const PT_MARKERS = /\b(você|obrigad|também|então|está|não|sim|vamos|cliente|projeto|coisa|gente|beleza|tá)\b/i;
export const FOREIGN = /[Ѐ-ӿ一-鿿぀-ゟ]/;
export const DATA_QUESTION = /(preço|preco|quanto|custa|status do|pedido|financeiro|fatur|caixa)/i;
export const HONEST_MARKERS = /(verificar|confirmar|não tenho|nao tenho|dashboard|vou checar|sem certeza|tool|consult)/i;
export const PRICE_INVENTION = /(r\$|€|usd)\s?\d/i;

export function scoreGolden(g: Golden, reply: string): { nota: number; falhas: string[] } {
  let nota = 0;
  const falhas: string[] = [];
  if (!FOREIGN.test(reply) && (PT_MARKERS.test(reply) || /[ãõçéêáâí]/.test(reply))) nota += 25;
  else falhas.push('idioma');
  if (g.expect.mencionarAutorPeloNome) {
    if (reply.toLowerCase().includes(g.input.de.toLowerCase().split(' ')[0]!)) nota += 25;
    else falhas.push('nome do autor');
  } else nota += 25;
  if (!/whatsapp\.net|@s\.whatsapp|@g\.us/.test(reply)) nota += 25;
  else falhas.push('vazou identificador interno');
  if (DATA_QUESTION.test(g.input.pergunta)) {
    if (HONEST_MARKERS.test(reply) || !PRICE_INVENTION.test(reply)) nota += 25;
    else falhas.push('pode ter inventado dado');
  } else nota += 25;
  return { nota, falhas };
}

export function scoreRun(goldens: Golden[], replies: string[]): { media: number; passaram: number; total: number; detalhes: Array<{ id: string; nota: number; falhas: string[] }> } {
  let soma = 0;
  let passaram = 0;
  const detalhes = goldens.map((g, i) => {
    const s = scoreGolden(g, replies[i] ?? '');
    soma += s.nota;
    if (s.nota >= 75) passaram++;
    return { id: g.id, nota: s.nota, falhas: s.falhas };
  });
  return { media: soma / goldens.length, passaram, total: goldens.length, detalhes };
}

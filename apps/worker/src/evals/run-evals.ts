import { readFileSync } from 'node:fs';
import { loadDotEnv, loadConfig } from '@luna/shared';
import { createAdapter } from '@luna/agent';
import { PERSONA_SUMMARY } from '../../../../apps/orchestrator/src/agent/context.js';

/**
 * Golden Conversations runner (§29 evals): roda as conversas golden pela LLM
 * REAL (key do .env) e pontua por heurísticas determinísticas. Não vai na
 * suíte de testes (não-determinístico) — roda com:
 *   pnpm --filter worker exec tsx src/evals/run-evals.ts
 * Uso: antes de mudar o system prompt/persona — comparar o score com a run
 * anterior. Score < 70% = regressão de comportamento.
 */

interface Golden {
  id: string;
  input: { de: string; pergunta: string };
  respostaReal: string;
  expect: { idioma: string; mencionarAutorPeloNome: boolean; nuncaInventarDado: boolean };
}

const fixture = JSON.parse(
  readFileSync('C:/Users/Abner/Documents/Luna cto/luna-agent/tests/evals/golden-conversations.json', 'utf8'),
) as { conversas: Golden[] };

const PT_MARKERS = /\b(você|obrigad|também|então|está|não|sim|vamos|cliente|projeto|coisa|gente|beleza|tá)\b/i;
const FOREIGN = /[\u0400-\u04FF\u4e00-\u9fff\u3040-\u309f]/;
const DATA_QUESTION = /(preço|preco|quanto|custa|status do|pedido|financeiro|fatur|caixa)/i;
const HONEST_MARKERS = /(verificar|confirmar|não tenho|nao tenho|dashboard|vou checar|sem certeza|tool|consult)/i;
const PRICE_INVENTION = /(r\$|€|usd)\s?\d/i;

function score(g: Golden, reply: string): { nota: number; falhas: string[] } {
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

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const adapter = createAdapter({
    mode: 'kimi-api',
    apiKey: config.LLM_API_KEY,
    apiBaseUrl: config.LLM_BASE_URL,
    apiModel: config.LLM_MODEL,
  });

  let total = 0;
  let passaram = 0;
  for (const g of fixture.conversas) {
    const prompt = [
      PERSONA_SUMMARY,
      '',
      `Contexto: conversa do grupo interno da Nexo Digital. Autor da mensagem: ${g.input.de}.`,
      `Mensagem: ${g.input.pergunta}`,
      '',
      'Responda como Luna.',
    ].join('\n');
    const turn = await adapter.sendTurn({ session_key: `eval:${g.id}`, prompt });
    const s = score(g, turn.reply_text);
    total += s.nota;
    const ok = s.nota >= 75;
    if (ok) passaram++;
    console.log(`${ok ? '✅' : '❌'} ${g.id}: ${s.nota}/100${s.falhas.length ? ' — falhas: ' + s.falhas.join(', ') : ''}`);
  }
  const media = total / fixture.conversas.length;
  console.log(`\nSCORE MÉDIO: ${media.toFixed(0)}/100 (${passaram}/${fixture.conversas.length} passaram)`);
  if (media < 70) {
    console.log('REGRESSÃO DE COMPORTAMENTO — revisar o prompt/persona antes de commitar.');
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

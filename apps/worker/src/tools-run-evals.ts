import { readFileSync } from 'node:fs';
import { loadDotEnv, loadConfig } from '@luna/shared';
import { createAdapter } from '@luna/agent';
import { PERSONA_SUMMARY } from '../../../apps/orchestrator/src/agent/context.js';

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

import { scoreGolden } from './evals/score.js';

const MOCK = process.argv.includes('--mock');

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
    const reply = MOCK
      ? g.respostaReal // determinístico: a resposta real passa no scoring (harness 100%)
      : (await adapter.sendTurn({ session_key: `eval:${g.id}`, prompt })).reply_text;
    const s = scoreGolden(g, reply);
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

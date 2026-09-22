import { loadDotEnv, loadConfig } from '@luna/shared';
import { createLogger } from '@luna/logging';
import { getPool } from '@luna/database';
import { createAdapter } from '@luna/agent';
import { buildClientConversationPack, renderConversationPrompt } from '../../../apps/orchestrator/src/agent/context.js';
import { parseStructured } from '../../../apps/orchestrator/src/agent/router/structured.js';

/**
 * Replay (§29): reexecuta um evento REAL (por event_id) em modo dry-run —
 * monta o prompt que o handler montaria e chama o FAST, SEM inserir nada.
 * Compara o router_output com o que foi persistido em agent_runs.
 *
 *   pnpm --filter worker exec tsx src/replay.ts <event_id>
 */

const log = createLogger({ name: 'replay' });
const eventId = process.argv[2];
if (!eventId) {
  console.log('uso: tsx src/replay.ts <event_id>');
  process.exit(1);
}

loadDotEnv();
const config = loadConfig();
const pool = getPool(config.DATABASE_URL);

async function main(): Promise<void> {
  const ev = await pool.query<{ payload: { payload?: { conversation_id?: string; text?: string } } }>(
    'SELECT payload FROM events WHERE event_id = $1',
    [eventId],
  );
  if (!ev.rowCount) throw new Error(`evento ${eventId} não encontrado`);
  const inner = ev.rows[0]!.payload.payload ?? {};
  if (!inner.conversation_id || inner.text === undefined) throw new Error('evento sem conversation_id/text');

  const pack = await buildClientConversationPack(pool, inner.conversation_id);
  const prompt = renderConversationPrompt(pack, inner.text, null);
  const adapter = createAdapter({
    mode: 'kimi-api',
    apiKey: config.LLM_API_KEY,
    apiBaseUrl: config.LLM_BASE_URL,
    apiModel: config.LLM_MODEL,
  });
  const turn = await adapter.sendTurn({ session_key: `replay:${eventId}`, prompt });
  const { output } = parseStructured(turn.reply_text);

  const original = await pool.query<{ output: { router_output?: string } }>(
    `SELECT output FROM agent_runs WHERE event_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [eventId],
  );

  console.log('═══ REPLAY §29 ═══');
  console.log('evento:      ', eventId);
  console.log('conversa:    ', inner.conversation_id);
  console.log('pergunta:    ', inner.text.slice(0, 100));
  console.log('router_output replay:  ', output.type);
  console.log('router_output original:', original.rows[0]?.output?.router_output ?? '(sem agent_run)');
  console.log('resposta (excerpt):', (output.type === 'ANSWER' ? output.text : JSON.stringify(output)).slice(0, 220));
  log.info('replay concluído (dry-run — nada persistido)');
  await pool.end();
}

main().catch((err) => {
  log.fatal({ err }, 'replay falhou');
  process.exit(1);
});

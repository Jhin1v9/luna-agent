/**
 * TOOL KIMI WORK — contexto de contato (decreto owner 2026-09-24).
 * Uso (de dentro do workspace do luna-agent):
 *   tsx tools/kimiwork-context.mts --phone "+34 685 09 31 92"
 *   tsx tools/kimiwork-context.mts --name "Jessica"
 * Imprime o bloco de contexto (quem é, última conversa, histórico) pronto
 * pra injetar no prompt do Operador no ChatGPT ou pra decidir uma ação.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
// import direto do SOURCE (a resolução de workspace @luna/* falha de tools/)
import { buildContactContext, formatContactContextText } from '../packages/database/src/context-builder.js';

const args = process.argv.slice(2);
const phone = args[args.indexOf('--phone') + 1];
const name = args[args.indexOf('--name') + 1];
if (!phone && !name) {
  console.error('uso: tsx tools/kimiwork-context.mts --phone "+34..." | --name "Jessica"');
  process.exit(1);
}
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const pool = new pg.Pool({ connectionString: env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim() });
const ctx = await buildContactContext(pool, { phone, name });
console.log(formatContactContextText(ctx));
await pool.end();

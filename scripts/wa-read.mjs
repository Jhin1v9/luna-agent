#!/usr/bin/env node
/**
 * wa-read.mjs — Lê últimas mensagens de QUALQUER chat WhatsApp (banco local).
 * Uso: node scripts/wa-read.mjs --chat "Enoque" [--limit 5] [--all]
 *
 * DECRETO OWNER 2026-10-01: variável aberta. --chat aceita nome parcial.
 * Por padrão mostra inbound+e outbound; --all inclui metadados completos.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, required = true, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || !process.argv[i + 1]) {
    if (required && dflt === null) { console.error(`ERRO: --${name} é obrigatório`); process.exit(2); }
    return dflt;
  }
  return process.argv[i + 1];
}

const chat = arg('chat');
const limit = parseInt(arg('limit', false, '5'), 10);
const all = process.argv.includes('--all');

const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const get = (k) => { const m = env.match(new RegExp(`^${k}=(.+)$`, 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };

const c = new Client({ connectionString: get('DATABASE_URL') });
await c.connect();

const r = await c.query(
  `SELECT conv.id, ct.name, ct.address, count(m.id) AS msgs
   FROM conversations conv
   JOIN contacts ct ON ct.id = conv.contact_id
   LEFT JOIN messages m ON m.conversation_id = conv.id
   WHERE conv.channel = 'whatsapp' AND (ct.address ILIKE $1 OR ct.name ILIKE $1)
   GROUP BY conv.id, ct.name, ct.address
   ORDER BY msgs DESC`,
  [`%${chat}%`],
);
if (r.rowCount === 0) { console.error(`ERRO: nenhum chat casa com '${chat}'`); process.exit(1); }
// Duplicatas exatas de endereço (grupo remapeado 2x pela Geral): usa a conversation
// com mais histórico. Endereços DIFERENTES continuam ambíguos — aborta.
const distinct = [...new Set(r.rows.map((x) => x.address.toLowerCase()))];
if (r.rowCount > 1 && distinct.length > 1) {
  console.error(`ERRO: ambíguo — ${r.rowCount} matches:`);
  r.rows.forEach((x) => console.error(`  - ${x.name} (${x.msgs} msgs)`));
  process.exit(1);
}
if (r.rowCount > 1) console.warn(`aviso: ${r.rowCount} conversations duplicadas do mesmo chat — usando a com mais histórico (${r.rows[0].msgs} msgs)`);

const msgs = await c.query(
  `SELECT direction, author_name, body, send_state, metadata, created_at
   FROM messages WHERE conversation_id = $1 AND channel = 'whatsapp'
   ORDER BY created_at DESC LIMIT $2`,
  [r.rows[0].id, limit],
);

console.log(`=== ${r.rows[0].name} (últimas ${msgs.rowCount}) ===`);
for (const m of msgs.rows.reverse()) {
  const who = m.direction === 'outbound' ? 'Luna' : (m.author_name ?? 'contato');
  const st = m.direction === 'outbound' ? ` [${m.send_state ?? '-'}]` : '';
  console.log(`\n[${m.created_at}] ${who}${st}:`);
  console.log(m.body);
  if (all) console.log('meta:', JSON.stringify(m.metadata));
}

await c.end();

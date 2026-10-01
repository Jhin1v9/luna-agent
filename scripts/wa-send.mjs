#!/usr/bin/env node
/**
 * wa-send.mjs — Envia mensagem WhatsApp como Luna para QUALQUER chat.
 * Uso: node scripts/wa-send.mjs --chat "Enoque" --text "Bom dia! 🌙"
 *      node scripts/wa-send.mjs --chat "🏆Production - 2026🙏🏻" --text "..." --quote "trecho pra citar"
 *
 * DECRETO OWNER 2026-10-01: script genérico com variável aberta — o chat e o
 * texto são parâmetros. Se o nome mudar, muda só a variável, não o script.
 *
 * Resolução do destino: contact.address/name ILIKE %chat%. Ambíguo → lista
 * matches e sai sem enviar (fail-closed). Entrega: messages(send_state
 * queued) + pg_notify('luna_outbound'). Guardrail de allowlist do whatsplay
 * continua valendo no destino (erro explícito se fora).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, required = true) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || !process.argv[i + 1]) {
    if (required) { console.error(`ERRO: --${name} é obrigatório`); process.exit(2); }
    return null;
  }
  return process.argv[i + 1];
}

const chat = arg('chat');
const text = arg('text');
const quote = arg('quote', false);

const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const get = (k) => { const m = env.match(new RegExp(`^${k}=(.+)$`, 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };

const c = new Client({ connectionString: get('DATABASE_URL') });
await c.connect();

const r = await c.query(
  `SELECT ct.id, ct.address, ct.name FROM conversations conv
   JOIN contacts ct ON ct.id = conv.contact_id
   WHERE conv.channel = 'whatsapp' AND (ct.address ILIKE $1 OR ct.name ILIKE $1)`,
  [`%${chat}%`],
);

if (r.rowCount === 0) {
  console.error(`ERRO: nenhum chat WhatsApp casa com '${chat}'. Verifique o nome salvo no WhatsApp.`);
  process.exit(1);
}
const distinct = [...new Map(r.rows.map((x) => [x.id, x])).values()];
if (distinct.length > 1) {
  console.error(`ERRO: '${chat}' é ambíguo — ${distinct.length} matches:`);
  distinct.forEach((x) => console.error(`  - ${x.name} | ${x.address}`));
  process.exit(1);
}

const target = r.rows[0];
const metadata = { correlation_id: `corr-${crypto.randomUUID()}` };
if (quote) metadata.reply_to_query = quote;

const ins = await c.query(
  `INSERT INTO messages (conversation_id, direction, channel, sender, body, author_name, metadata, send_state)
   VALUES ((SELECT id FROM conversations WHERE contact_id = $1 AND channel = 'whatsapp' LIMIT 1),
           'outbound', 'whatsapp', 'luna', $2, 'Luna', $3::jsonb, 'queued') RETURNING id`,
  [target.id, text, JSON.stringify(metadata)],
);
await c.query(`SELECT pg_notify('luna_outbound', $1)`, [ins.rows[0].id]);
console.log(`enfileirada → ${target.name} | message_id: ${ins.rows[0].id}`);
console.log('aguarde ~20s e confira: node scripts/wa-read.mjs --chat "' + chat + '" --limit 1');

await c.end();

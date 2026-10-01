#!/usr/bin/env node
/**
 * wa-call.mjs — Liga para QUALQUER contato registrado no Chat Registry.
 * Uso: node scripts/wa-call.mjs --to "Abner" [--motivo "motivo da ligação"]
 *      node scripts/wa-call.mjs --register "Abner" --phone "+34 ..." --note "CEO Nexo"
 *
 * DECRETO OWNER 2026-10-01: --to é a variável aberta. Se o nome mudar, muda
 * só a variável. O destino é resolvido pelo Chat Registry (fail-closed: fora
 * do registry = recusa explícita). Ligação exige VOICE_CALL_ENABLED=true.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, required = false) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || !process.argv[i + 1]) {
    if (required) { console.error(`ERRO: --${name} é obrigatório`); process.exit(2); }
    return null;
  }
  return process.argv[i + 1];
}

const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const get = (k) => { const m = env.match(new RegExp(`^${k}=(.+)$`, 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };

const c = new Client({ connectionString: get('DATABASE_URL') });
await c.connect();

// Modo registro: --register "Nome" --phone "+34..." [--note "..."] [--role allowed]
const reg = arg('register');
if (reg) {
  const phone = arg('phone', true);
  const note = arg('note', false) ?? '';
  const role = arg('role', false) ?? 'allowed';
  const slug = reg.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  await c.query(
    `INSERT INTO chat_registry (chat_key, kind, canonical_name, display_hint, role, notify_channel, resolved_at, resolved_by, note)
     VALUES ($1, 'individual', $2, $2, $3, 'whatsapp', now(), 'luna', $4)
     ON CONFLICT (chat_key) DO UPDATE SET canonical_name = EXCLUDED.canonical_name, role = EXCLUDED.role, note = EXCLUDED.note, resolved_at = now()`,
    [`individual:${slug}`, reg, role, `${phone} · ${note}`],
  );
  console.log(`registrado: individual:${slug} → ${reg} (${phone})`);
  await c.end();
  process.exit(0);
}

const to = arg('to', true);
const motivo = arg('motivo', false) ?? 'ligação solicitada pela Luna';

const regCheck = await c.query(
  `SELECT canonical_name, role, chat_key FROM chat_registry WHERE canonical_name ILIKE $1 OR display_hint ILIKE $1 ORDER BY resolved_at DESC LIMIT 1`,
  [`%${to}%`],
);
if (regCheck.rowCount === 0) {
  console.error(`ERRO: '${to}' NÃO está no Chat Registry — fail-closed. Registre primeiro:`);
  console.error(`  node scripts/wa-call.mjs --register "${to}" --phone "+34 ..." --note "quem é"`);
  process.exit(1);
}
if (get('VOICE_CALL_ENABLED') !== 'true') {
  console.error('ERRO: VOICE_CALL_ENABLED≠true — ligações desligadas (contenção pós-incidente). Peça ao owner para ligar.');
  process.exit(1);
}

const destinatario = regCheck.rows[0].canonical_name;
const brief = { destinatario, motivo, solicitado_por: 'luna', ts: new Date().toISOString() };
const eventId = `evt_call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

await c.query(
  `INSERT INTO events (event_id, event_type, source, payload, idempotency_key, occurred_at, created_at)
   VALUES ($1, 'voice.call.requested', 'luna-script', $2::jsonb, $3, now(), now())`,
  [eventId, JSON.stringify(brief), `script:call:${eventId}`],
);
await c.query(`SELECT pg_notify('voice_call_requests', $1)`, [eventId]);
console.log(`chamada enfileirada → ${destinatario} | event: ${eventId}`);
console.log('o whatsplay executa (pré-voo + discagem + conductora). Acompanhe: tail logs-whatsplay.out.log');

await c.end();

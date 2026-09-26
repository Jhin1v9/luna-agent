#!/usr/bin/env node
// ASK-OWNER — envia mensagem pro grupo 🏆Production - 2026🙏🏻 via fila outbound
// do whatsplay (zero polling: INSERT + pg_notify; o whatsplay escuta e envia).
//
// Uso:
//   node scripts/ask-owner.mjs "Resumo do que o Kimi Code fez"           (relatório)
//   node scripts/ask-owner.mjs --ask "Plano X (N fases). Posso executar?" (pede OK e encerra)
//   node scripts/ask-owner.mjs --dry-run "texto"                          (só resolve o destino, não envia)
//
// Guardrails herdados: send-safety + blocklist do Chat Registry valem sempre;
// a allowlist de dev cobre o grupo. Sem --to, resolve sozinho a conversa do
// grupo pelo contacts.address @g.us + nome "Production".

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const fail = (msg) => { console.error('[ask-owner] ' + msg); process.exit(1); };

// ---- args ----
const ask = process.argv.includes('--ask');
const dryRun = process.argv.includes('--dry-run');
const toIdx = process.argv.indexOf('--to');
const to = toIdx > -1 ? process.argv[toIdx + 1] : null;
const text = process.argv.filter((a, i) => i >= 2 && a !== '--ask' && a !== '--dry-run' && a !== '--to' && i !== toIdx + 1).join(' ').trim();
if (!text) fail('uso: node scripts/ask-owner.mjs [--ask] [--to nome-ou-jid] "texto"');

// ---- env (.env do repo; NUNCA imprimir valores) ----
const envPath = join(ROOT, '.env');
if (!existsSync(envPath)) fail('.env não encontrado em ' + ROOT);
const env = {};
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const url = env.DATABASE_URL || fail('DATABASE_URL ausente no .env');
if (!/^postgres(ql)?:\/\//.test(url)) fail('DATABASE_URL não é postgres://');

// ---- pg puro (sem dependência nova no repo) ----
const { default: pg } = await import('pg').catch(() => import('node:module').then(() => fail('pacote pg indisponível — rode a partir do repo com node_modules instalado')));

const pool = new pg.Pool({ connectionString: url });
try {
  // ---- resolve conversa do grupo ----
  let conv;
  if (to) {
    const r = await pool.query(
      `SELECT cv.id, ct.address, ct.name
         FROM conversations cv JOIN contacts ct ON ct.id = cv.contact_id
        WHERE ct.address = $1 OR ct.address ILIKE $2 OR ct.name ILIKE $2
        ORDER BY cv.created_at DESC LIMIT 1`,
      [to.includes('@') ? to : '__none__', `%${to}%`],
    );
    conv = r.rows[0];
  } else {
    const r = await pool.query(
      `SELECT cv.id, ct.address, ct.name
         FROM conversations cv JOIN contacts ct ON ct.id = cv.contact_id
        WHERE (ct.address ILIKE '%Production%' OR ct.name ILIKE '%Production%')
        ORDER BY cv.created_at DESC LIMIT 1`,
    );
    conv = r.rows[0];
  }
  if (!conv) fail(`conversa do grupo não encontrada${to ? ' para --to ' + to : ''} (contacts/conversations)`);
  console.log(`[ask-owner] destino: ${conv.name} (${conv.address})`);
  const body = ask
    ? `⚠️ KIMI CODE — PRECISA DE OK\n\n${text}\n\nResponda "pode" pra executar ou "não" pra cancelar.`
    : `✅ KIMI CODE\n\n${text}`;

  if (dryRun) {
    console.log('[ask-owner] DRY-RUN: destino resolvido, nada enviado.');
  } else {
    const ins = await pool.query(
      `INSERT INTO messages (conversation_id, direction, channel, sender, body, send_state, metadata)
       VALUES ($1, 'outbound', 'whatsapp', 'kimi-code', $2, 'queued', $3) RETURNING id`,
      [conv.id, body, JSON.stringify({ sweep_triage: true, ask })],
    );
    await pool.query('SELECT pg_notify($1, $2)', ['luna_outbound', ins.rows[0].id]);
    console.log(`[ask-owner] mensagem ${ins.rows[0].id} enfileirada — whatsplay entrega.`);
  }
} finally {
  await pool.end();
}

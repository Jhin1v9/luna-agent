#!/usr/bin/env node
/**
 * wa-ingest.mjs — One-shot: lê as últimas mensagens AO VIVO de QUALQUER chat
 * WhatsApp e ingere na fila (kimiwork_inbox) — mesmo que o chat esteja fora
 * da allowlist ou as mensagens já lidas. É o "sweep isolado" genérico.
 *
 * Uso: node scripts/wa-ingest.mjs --chat "Nome do Grupo"
 *
 * Como funciona: isola a WHATSAPP_INGEST_ALLOWLIST no chat alvo, liga o
 * sweep, reinicia o whatsplay (pm2), aguarda a captura, restaura tudo e
 * reinicia de novo. Restauração é garantida mesmo em erro (try/finally).
 * DECRETO OWNER 2026-10-01: --chat é variável aberta; nome mudou, só muda a variável.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(ROOT, '.env');
const PM2 = process.platform === 'win32'
  ? path.join(process.env.APPDATA || 'C:/Users/Abner/AppData/Roaming', 'npm/pm2')
  : 'pm2';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || !process.argv[i + 1]) { console.error(`ERRO: --${name} é obrigatório`); process.exit(2); }
  return process.argv[i + 1];
}
const chat = arg('chat');
const waitS = parseInt(process.argv[process.argv.indexOf('--wait') + 1] || '75', 10);

const env = fs.readFileSync(ENV_PATH, 'utf8');
const getRe = (k) => new RegExp(`^${k}=(.*)$`, 'm');
const get = (k) => { const m = env.match(getRe(k)); return m ? m[1] : null; };

const ingestOrig = get('WHATSAPP_INGEST_ALLOWLIST');
const sweepOrig = get('WHATSAPP_SWEEP_ENABLED');
if (!ingestOrig) { console.error('ERRO: WHATSAPP_INGEST_ALLOWLIST não encontrado no .env'); process.exit(1); }

const restart = () => execFileSync(PM2, ['restart', 'luna-whatsplay'], { stdio: 'pipe' });

console.log(`[1/4] isolando allowlist em: ${chat}`);
let cur = fs.readFileSync(ENV_PATH, 'utf8');
cur = cur.replace(getRe('WHATSAPP_INGEST_ALLOWLIST'), `WHATSAPP_INGEST_ALLOWLIST=${chat.replace(/[$]/g, '')}`);
cur = cur.replace(getRe('WHATSAPP_SWEEP_ENABLED'), 'WHATSAPP_SWEEP_ENABLED=true');
fs.writeFileSync(ENV_PATH, cur);

try {
  restart();
  console.log(`[2/4] whatsplay reiniciado — aguardando sweep capturar (${waitS}s)...`);
  await new Promise((r) => setTimeout(r, waitS * 1000));
  console.log('[3/4] verificando kimiwork_inbox...');
  const check = execFileSync(process.execPath, ['-e', `
    const fs = require('fs');
    const env = fs.readFileSync('${ENV_PATH.replace(/\\/g, '/')}', 'utf8');
    const get = (k) => { const m = env.match(new RegExp('^' + k + '=(.+)$', 'm')); return m ? m[1].trim() : null; };
    const { Client } = require('pg');
    (async () => {
      const c = new Client({ connectionString: get('DATABASE_URL') });
      await c.connect();
      const r = await c.query("SELECT kind, status, received_at, left(payload->>'text', 120) AS texto FROM kimiwork_inbox ORDER BY received_at DESC LIMIT 3");
      r.rows.forEach(x => console.log(' ', x.received_at, '|', x.kind, '|', x.status, '|', x.texto));
      await c.end();
    })().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
  `], { cwd: ROOT, stdio: 'inherit' });
} finally {
  console.log('[4/4] restaurando .env e reiniciando...');
  let restore = fs.readFileSync(ENV_PATH, 'utf8');
  restore = restore.replace(getRe('WHATSAPP_INGEST_ALLOWLIST'), `WHATSAPP_INGEST_ALLOWLIST=${ingestOrig}`);
  restore = restore.replace(getRe('WHATSAPP_SWEEP_ENABLED'), `WHATSAPP_SWEEP_ENABLED=${sweepOrig}`);
  fs.writeFileSync(ENV_PATH, restore);
  restart();
}

console.log('OK — allowlist restaurada, sweep voltou ao estado original, whatsplay reiniciado.');

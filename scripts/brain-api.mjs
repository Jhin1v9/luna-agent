#!/usr/bin/env node
/**
 * brain-api.mjs — Cliente genérico do brain remoto (Bearer BRAIN_API_TOKEN).
 * Uso: node scripts/brain-api.mjs GET /brain/api/learning/outcomes
 *      node scripts/brain-api.mjs POST /brain/api/learning/outcomes --body '{"type":"positive","title":"...","body":"..."}'
 *      node scripts/brain-api.mjs POST /brain/api/learning/outcomes --file caminho/grande.md --type positive --title "..."
 *
 * DECRETO OWNER 2026-10-01: rota/body variáveis abertas. --file pra body grande
 * (lê do arquivo do workspace). Token nunca impresso.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const get = (k) => { const m = env.match(new RegExp(`^${k}=(.+)$`, 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 || !process.argv[i + 1] ? null : process.argv[i + 1];
}

const BASE = (get('BRAIN_API_URL') || 'https://vps.nexo-digital.app').replace(/\/$/, '');
const token = get('BRAIN_API_TOKEN');
if (!token) { console.error('ERRO: BRAIN_API_TOKEN não encontrado no .env'); process.exit(1); }

const [, , cmd, route] = process.argv;
if (!cmd || !route) {
  console.log('Uso: node scripts/brain-api.mjs <GET|POST> <rota> [--body \'{...}\'] [--file path] [--type t] [--title t]');
  process.exit(2);
}

let body = null;
const file = arg('file');
if (file) {
  body = { type: arg('type') ?? 'positive', title: arg('title') ?? path.basename(file), body: fs.readFileSync(path.resolve(ROOT, file), 'utf8') };
} else if (arg('body')) {
  body = JSON.parse(arg('body'));
}

const r = await fetch(`${BASE}${route}`, {
  method: cmd.toUpperCase(),
  headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
  signal: AbortSignal.timeout(30000),
});
const text = await r.text();
console.log(`[${r.status}] ${cmd.toUpperCase()} ${route}`);
try { console.log(JSON.stringify(JSON.parse(text), null, 2).slice(0, 4000)); } catch { console.log(text.slice(0, 4000)); }

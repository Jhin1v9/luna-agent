#!/usr/bin/env node
/**
 * painel-api.mjs — Cliente genérico autenticado do painel Nexo (NextAuth).
 * Uso: node scripts/painel-api.mjs GET /nexo/api/admin/requests
 *      node scripts/painel-api.mjs POST /nexo/api/admin/requests --body '{"organizationId":"...","projectId":"...","content":"..."}'
 *      node scripts/painel-api.mjs relogin   ← força novo login (cookie expirado)
 *
 * Cookie reutilizável em .brain/.vps_cookie (relogin automático se 401/403).
 * DECRETO OWNER 2026-10-01: rota e body são variáveis abertas — serve para
 * requests, organizations, projects, clients, comentários, ações, o que for.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COOKIE_PATH = path.join(ROOT, '.brain', '.vps_cookie');
const BASE = 'https://vps.nexo-digital.app';

const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const get = (k) => { const m = env.match(new RegExp(`^${k}=(.+)$`, 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };

function readCookie() {
  try { return fs.readFileSync(COOKIE_PATH, 'utf8').trim().split('\n').join('; '); } catch { return null; }
}

async function doLogin() {
  const c1 = await fetch(`${BASE}/nexo/api/auth/csrf`);
  const csrf = await c1.json();
  const jar = c1.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const res = await fetch(`${BASE}/nexo/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar },
    body: new URLSearchParams({
      csrfToken: csrf.csrfToken,
      email: get('NEXO_API_USERNAME'),
      password: get('NEXO_API_PASSWORD'),
      callbackUrl: `${BASE}/nexo/pt`,
    }).toString(),
    redirect: 'manual',
  });
  const session = res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('nexo.session-token='));
  if (!session) throw new Error(`login falhou (status ${res.status})`);
  fs.writeFileSync(COOKIE_PATH, `nexo.csrf-token=${csrf.csrfToken}\n${session}\n`);
  return readCookie();
}

async function call(method, route, body) {
  let cookie = readCookie();
  const headers = { cookie };
  if (body) headers['content-type'] = 'application/json';
  let r = await fetch(`${BASE}${route}`, { method, headers, body: body ? JSON.stringify(JSON.parse(body)) : undefined, signal: AbortSignal.timeout(20000) });
  if (r.status === 401 || r.status === 403) {
    console.error(`[${r.status}] sessão expirada — relogando...`);
    cookie = await doLogin();
    r = await fetch(`${BASE}${route}`, { method, headers: { ...headers, cookie }, body: body ? JSON.stringify(JSON.parse(body)) : undefined, signal: AbortSignal.timeout(20000) });
  }
  const text = await r.text();
  console.log(`[${r.status}] ${method} ${route}`);
  try { console.log(JSON.stringify(JSON.parse(text), null, 2)); } catch { console.log(text); }
}

const [, , cmd, route, , body] = process.argv;
if (cmd === 'relogin') { await doLogin(); console.log('login OK — cookie renovado'); }
else if (cmd && route) { await call(cmd.toUpperCase(), route, body ?? null); }
else {
  console.log('Uso: node scripts/painel-api.mjs <GET|POST|PUT|DELETE> <rota> [--body \'{...}\'] | relogin');
  process.exit(2);
}

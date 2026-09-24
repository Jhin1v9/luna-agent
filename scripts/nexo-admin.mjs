// Login NextAuth no workspace Nexo + chamada autenticada de API admin.
// Uso: node scripts/nexo-admin.mjs <method> <path> [body-json]
// Ex.: node scripts/nexo-admin.mjs GET /nexo/api/admin/requests
//      node scripts/nexo-admin.mjs POST /nexo/api/admin/requests '{"organizationId":"...","projectId":"...","content":"..."}'
// Credenciais: NEXO_API_USERNAME/NEXO_API_PASSWORD no .env (já carregado pelo
// dotenv do repo? não — lemos o .env na mão, simples).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.NEXO_API_BASE_URL ?? 'https://vps.nexo-digital.app';
const ROOT = process.cwd(); // rodar da raiz do repo (pnpm/script)
const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const USER = process.env.NEXO_USER_TRY ?? env.NEXO_API_USERNAME;
const PASS = env.NEXO_API_PASSWORD;
const COOKIE_FILE = process.env.NEXO_COOKIE_FILE ?? join(ROOT, '.brain/.vps_cookie');

function parseCookies(setCookies) {
  const jar = {};
  for (const sc of setCookies ?? []) {
    const [pair] = sc.split(';');
    const i = pair.indexOf('=');
    jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return jar;
}
const cookieHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

async function main() {
  // Git Bash converte args que começam com '/' em paths Windows — desfaz.
  const sanitize = (p) => p.replace(/^[A-Za-z]:\/[^]*?\/Git(?=\/)/, '');
  const [, , methodRaw = 'GET', pathRaw = '/nexo/api/admin/requests', body] = process.argv;
  const method = sanitize(methodRaw);
  const path = sanitize(pathRaw);
  if (process.env.NEXO_DEBUG) console.error('DEBUG url:', `${BASE}${path}`);
  // 1) tenta cookie salvo primeiro
  let jar = {};
  try {
    for (const line of readFileSync(COOKIE_FILE, 'utf8').split('\n')) {
      if (!line.trim() || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i > 0) jar[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch { /* sem cookie — vai logar */ }

  let resp = await fetch(`${BASE}${path}`, {
    method,
    headers: { cookie: cookieHeader(jar) },
    body: body ? body : undefined,
  });
  if (resp.status === 401 || resp.status === 403) {
    // 2) login fresh: CSRF → callback credentials
    const csrfResp = await fetch(`${BASE}/nexo/api/auth/csrf`);
    const csrfJar = parseCookies(csrfResp.headers.getSetCookie?.() ?? []);
    const { csrfToken } = await csrfResp.json();
    const loginResp = await fetch(`${BASE}/nexo/api/auth/callback/credentials`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: cookieHeader(csrfJar),
      },
      body: new URLSearchParams({ csrfToken, username: USER, password: PASS, callbackUrl: `${BASE}/nexo/admin` }),
      redirect: 'manual',
    });
    const loginCookies = parseCookies(loginResp.headers.getSetCookie?.() ?? []);
    const loc = loginResp.headers.get('location') ?? '';
    if (!loginCookies['next-auth.session-token'] && !loginCookies['__Secure-next-auth.session-token']) {
      const err = await loginResp.text().catch(() => '');
      console.error(`LOGIN FALHOU (${loginResp.status}) location=${loc} body=${err.slice(0, 200)}`);
      process.exit(2);
    }
    jar = { ...jar, ...loginCookies };
    const { writeFileSync } = await import('node:fs');
    writeFileSync(COOKIE_FILE, Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('\n'));
    resp = await fetch(`${BASE}${path}`, {
      method,
      headers: { cookie: cookieHeader(jar) },
      body: body ? body : undefined,
    });
  }
  const text = await resp.text();
  console.log(`HTTP ${resp.status}`);
  try { console.log(JSON.stringify(JSON.parse(text), null, 2)); }
  catch { console.log(text.slice(0, 2000)); }
  process.exit(resp.ok ? 0 : 1);
}
main().catch((e) => { console.error(String(e).slice(0, 300), '| cause:', e.cause?.code ?? '', e.cause?.message ?? ''); process.exit(1); });

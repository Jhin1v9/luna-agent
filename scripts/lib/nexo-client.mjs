// Cliente autenticado do painel Nexo (NextAuth). Extraído de nexo-admin.mjs
// pra reuso sem shell-out (spawn de node dentro de node abortava no libuv do
// Windows). Uso: const { getJson } = await import('../scripts/lib/nexo-client.mjs')
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.NEXO_API_BASE_URL ?? 'https://vps.nexo-digital.app';
const REPO = process.cwd();
const COOKIE_FILE = process.env.NEXO_COOKIE_FILE ?? join(REPO, '.brain/.vps_cookie');

function loadEnv() {
  return Object.fromEntries(
    readFileSync(join(REPO, '.env'), 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}

function parseCookies(setCookies) {
  const jar = {};
  for (const sc of setCookies ?? []) {
    const [pair] = sc.split(';');
    const i = pair.indexOf('=');
    jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return jar;
}
const header = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

export async function getJson(path) {
  let jar = {};
  try {
    for (const line of readFileSync(COOKIE_FILE, 'utf8').split('\n')) {
      if (!line.trim() || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i > 0) jar[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch { /* sem cookie — loga abaixo */ }

  let resp = await fetch(`${BASE}${path}`, { headers: { cookie: header(jar) } });
  if (resp.status === 401 || resp.status === 403) {
    const env = loadEnv();
    const csrfResp = await fetch(`${BASE}/nexo/api/auth/csrf`);
    const csrfJar = parseCookies(csrfResp.headers.getSetCookie?.());
    const { csrfToken } = await csrfResp.json();
    const loginResp = await fetch(`${BASE}/nexo/api/auth/callback/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: header(csrfJar) },
      body: new URLSearchParams({ csrfToken, email: env.NEXO_API_USERNAME, password: env.NEXO_API_PASSWORD, callbackUrl: `${BASE}/nexo/admin`, json: 'true' }),
      redirect: 'manual',
    });
    const loginCookies = parseCookies(loginResp.headers.getSetCookie?.());
    if (!Object.keys(loginCookies).some((k) => k.endsWith('session-token'))) {
      throw new Error(`login no painel falhou (302 location=${loginResp.headers.get('location') ?? '?'})`);
    }
    jar = { ...jar, ...loginCookies };
    writeFileSync(COOKIE_FILE, Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('\n'));
    resp = await fetch(`${BASE}${path}`, { headers: { cookie: header(jar) } });
  }
  const text = await resp.text();
  try {
    return { status: resp.status, body: JSON.parse(text) };
  } catch {
    return { status: resp.status, body: text };
  }
}

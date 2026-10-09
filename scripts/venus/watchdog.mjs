#!/usr/bin/env node
// Watchdog do Vênus — decreto owner 2026-10-09:
// "quando o Vênus morrer, a Luna detecta se tá off ou on, responde enquanto
// ele não responde e liga ele de volta."
//
// A cada 30s:
//   1. bate o próprio heartbeat (service_heartbeats 'venus-watchdog')
//   2. checa o colibri (cérebro do Vênus) — se fora do ar, TENTA religar
//      (Start-Process do START-HERE.bat, throttle de 5min, máx 3 tentativas
//      seguidas); se não voltar, alerta o owner e a Luna assume no cover
//   3. checa o beat de 'venus-varredura' — se >90s sem batida e colibri ok:
//      pm2 restart venus-varredura (com throttle de 3min entre tentativas);
//      se não voltar depois de 3 tentativas, alerta o owner
// Uso: node scripts/venus/watchdog.mjs   (pm2: venus-watchdog)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ENV = path.join(ROOT, '.env');
const COLIBRI = (process.env.VENUS_BASE_URL ?? 'http://127.0.0.1:8000/v1').replace(/\/$/, '');
const NODE = process.execPath;
const PM2_CLI = 'C:/Users/Abner/AppData/Roaming/npm/node_modules/pm2/bin/pm2';
const STALE_S = 90;
const LOOP_MS = 30_000;
const RESTART_THROTTLE_MS = 180_000;
const COLIBRI_RESTART_THROTTLE_MS = 300_000; // 5min entre tentativas de religar o colibri
const COLIBRI_BAT = 'C:\\Users\\Abner\\Downloads\\colibri-main\\START-HERE.bat';
const COLIBRI_DIR = 'C:\\Users\\Abner\\Downloads\\colibri-main';
const ALERT_THROTTLE_MS = 900_000; // 15min entre alertas repetidos

function envAll() {
  const out = {};
  for (const line of fs.readFileSync(REPO_ENV, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    out[t.slice(0, i)] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
async function db(query, params = []) {
  const c = new pg.Client({ connectionString: envAll().DATABASE_URL });
  await c.connect();
  try { return await c.query(query, params); } finally { await c.end(); }
}

let ultimoRestart = 0;
let restartsSeguidos = 0;
let ultimoRestartColibri = 0;
let restartsColibriSeguidos = 0;
let ultimoAlerta = 0;
let alertasColibri = 0;

async function log(msg) {
  console.log(`[venus-watchdog] ${msg}`);
  try {
    await db(
      `INSERT INTO service_heartbeats (service, pid, meta, seen_at) VALUES ('venus-watchdog',$1,$2,now())
       ON CONFLICT (service) DO UPDATE SET pid=$1, seen_at=now(), meta=$2`,
      [process.pid, JSON.stringify({ state: msg.slice(0, 120) })],
    );
  } catch { /* heartbeat é best-effort */ }
}

async function alertar(texto) {
  const now = Date.now();
  if (now - ultimoAlerta < ALERT_THROTTLE_MS) return;
  ultimoAlerta = now;
  const e = envAll();
  if (!e.TELEGRAM_BOT_TOKEN || !e.TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${e.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: Number(e.TELEGRAM_CHAT_ID), text: `[watchdog do Vênus] ${texto}` }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch { /* alerta é best-effort */ }
}

async function colibriOk() {
  try {
    const r = await fetch(`${COLIBRI}/models`, { signal: AbortSignal.timeout(3_000) });
    return r.ok;
  } catch { return false; }
}

async function venusAlive() {
  try {
    const r = await db(`SELECT seen_at FROM service_heartbeats WHERE service='venus-varredura'`);
    if (!r.rows[0]) return false;
    return Date.now() - new Date(r.rows[0].seen_at).getTime() <= STALE_S * 1000;
  } catch { return false; }
}

function religarVenus() {
  log('Vênus PARADO — religando (pm2 restart venus-varredura)');
  const child = spawn(NODE, [PM2_CLI, 'restart', 'venus-varredura'], { windowsHide: true });
  child.on('close', (code) => log(`pm2 restart retornou exit ${code}`));
  child.on('error', (e) => log(`falha ao religar: ${e.message}`));
}

function religarColibri() {
  log('colibri FORA — religando (Start-Process START-HERE.bat)');
  const ps = [
    '-NoProfile', '-Command',
    `Start-Process -FilePath '${COLIBRI_BAT}' -WorkingDirectory '${COLIBRI_DIR}'`,
  ];
  const child = spawn('powershell', ps, { windowsHide: true });
  child.on('close', (code) => log(`religar colibri retornou exit ${code}`));
  child.on('error', (e) => log(`falha ao religar o colibri: ${e.message}`));
}

async function ciclo(n) {
  const colibri = await colibriOk();
  const vivo = await venusAlive();
  await log(`ciclo ${n}: colibri=${colibri ? 'ok' : 'FORA'} venus=${vivo ? 'vivo' : 'PARADO'}`);

  if (!colibri) {
    alertasColibri++;
    const now = Date.now();
    // tenta religar o colibri; desiste depois de 3 tentativas seguidas e alerta
    if (
      restartsColibriSeguidos < 3 &&
      now - ultimoRestartColibri >= COLIBRI_RESTART_THROTTLE_MS
    ) {
      ultimoRestartColibri = now;
      restartsColibriSeguidos++;
      religarColibri();
      return; // dá tempo do colibri subir antes de tentar de novo
    }
    if (restartsColibriSeguidos >= 3) {
      await alertar(`Tentei religar o colibri ${restartsColibriSeguidos}x e ele não voltou. O Vênus não consegue pensar — a Luna assume as respostas do zap. Verifica a janela do START-HERE.bat.`);
    } else {
      await alertar(`O colibri (cérebro do Vênus) está FORA DO AR. Já tentei religar — a Luna assume as respostas do zap enquanto isso.`);
    }
    return; // religar o venus sem cérebro só gera erro em massa
  }
  if (restartsColibriSeguidos > 0) {
    log(`colibri voltou após ${restartsColibriSeguidos} tentativa(s) de religar`);
  }
  restartsColibriSeguidos = 0;
  alertasColibri = 0;

  if (!vivo) {
    const now = Date.now();
    if (now - ultimoRestart >= RESTART_THROTTLE_MS) {
      ultimoRestart = now;
      restartsSeguidos++;
      religarVenus();
      if (restartsSeguidos >= 3) {
        await alertar(`Religuei o Vênus ${restartsSeguidos}x e ele não voltou. Verifica aí (logs: pm2 logs venus-varredura).`);
        restartsSeguidos = 0;
      }
    }
  } else {
    restartsSeguidos = 0;
  }
}

let n = 0;
await log('no ar — vigiando o Vênus (decreto owner 2026-10-09)');
for (;;) {
  n++;
  try { await ciclo(n); } catch (e) { console.error(`[venus-watchdog] erro no ciclo: ${e.message}`); }
  await new Promise((r) => setTimeout(r, LOOP_MS));
}

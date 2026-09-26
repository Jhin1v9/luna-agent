#!/usr/bin/env node
// DISPATCH-SWEEP — Kimi Work chama ISTO quando (e somente quando) o sweep tem
// algo acionável. Quem decide se vale disparar é o Kimi Work (classificação do
// sweep); este script só dispara o Kimi Code de forma segura:
//   - lockfile (PID) — nunca dois Kimi Code no mesmo sweep
//   - dedupe por hash do arquivo — mesmo sweep não dispara 2x
//   - detached + log — não trava a automação do Kimi Work
//   - SWEEP_FILE via env (Git Bash corrompe caminhos Windows como argumento)
//
// Uso: node scripts/dispatch-sweep.mjs [caminho/do/sweep.md] [--dry-run]
// Sem argumento: pega o sweep *-projetos.md mais recente de .brain/luna/sweeps/
// --dry-run: valida lock/dedupe e mostra o que faria, SEM disparar o Kimi Code.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SWEEPS_DIR = join(ROOT, '.brain', 'luna', 'sweeps');
const LOCK = join(ROOT, '.brain', '.kimi-dispatch.lock');
const STATE = join(ROOT, '.brain', '.kimi-dispatch.json');
const LOG_DIR = join(ROOT, '.brain', 'logs');
const AGENT_FILE = join(ROOT, 'scripts', 'agents', 'sweep-triage.agent.md');
const BRAIN_DIR = 'C:\\Users\\Abner\\Documents\\principal-brain';

const fail = (msg, code = 1) => { console.error('[dispatch] ' + msg); process.exit(code); };

// ---- lockfile (padrão SYNAPSE) ----
if (existsSync(LOCK)) {
  const pid = Number(readFileSync(LOCK, 'utf8').trim());
  if (Number.isInteger(pid) && pid > 0) {
    try { process.kill(pid, 0); fail(`lock ativo (PID ${pid}) — Kimi Code já está processando um sweep`); }
    catch { /* processo morto, lock órfão */ }
  }
}

// ---- qual sweep? ----
const dryRun = process.argv.includes('--dry-run');
let sweep = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!sweep) {
  if (!existsSync(SWEEPS_DIR)) fail('pasta de sweeps não existe: ' + SWEEPS_DIR);
  const files = readdirSync(SWEEPS_DIR).filter(f => f.endsWith('-projetos.md'));
  if (!files.length) fail('nenhum sweep *-projetos.md encontrado em ' + SWEEPS_DIR);
  sweep = join(SWEEPS_DIR, files.sort().pop());
}
sweep = resolve(sweep);
if (!existsSync(sweep)) fail('sweep não encontrado: ' + sweep);

// ---- dedupe por hash ----
const hash = createHash('sha1').update(readFileSync(sweep)).digest('hex');
if (existsSync(STATE)) {
  try {
    const last = JSON.parse(readFileSync(STATE, 'utf8'));
    if (last.hash === hash) fail(`sweep já foi despachado (${last.at}) — nada a fazer`, 0);
  } catch { /* estado inexistente ou corrompido — segue e regrava */ }
}

if (dryRun) {
  console.log(`[dispatch] DRY-RUN: despacharia Kimi Code para ${sweep} (hash ${hash.slice(0, 8)})`);
  process.exit(0);
}

// ---- dispara Kimi Code (detached) ----
writeFileSync(LOCK, String(process.pid));
try {
  mkdirSync(LOG_DIR, { recursive: true });
  const logPath = join(LOG_DIR, `kimi-dispatch-${Date.now()}.log`);
  const logFd = (await import('node:fs')).openSync(logPath, 'a');
  const args = [
    '-p',
    `--agent-file "${AGENT_FILE}"`,
    '-y',
    `--add-dir "${BRAIN_DIR}"`,
    `"Processe o sweep em ${sweep} conforme o seu contrato (SWEEP_FILE já está no env)."`,
  ];
  const child = spawn('kimi', args, {
    cwd: ROOT,
    env: { ...process.env, SWEEP_FILE: sweep },
    shell: true,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  writeFileSync(STATE, JSON.stringify({ hash, at: new Date().toISOString(), sweep, pid: child.pid }, null, 2));
  console.log(`[dispatch] Kimi Code disparado (PID ${child.pid}) para ${sweep} — log: ${logPath}`);
} finally {
  // lock é do dispatcher (curto); a sessão Kimi Code é livre, dedupe segura por hash
  try { (await import('node:fs')).rmSync(LOCK); } catch {}
}

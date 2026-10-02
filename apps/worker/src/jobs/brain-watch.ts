import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { BRAIN_ROOT } from '@luna/brain';
import { publishEvent, recordActivity } from '@luna/database';
import type { JobHandler, JobRow } from './poller.js';

/**
 * brain.watch (decreto owner 27/09: "a skill do brain pra sempre que iniciar
 * ir lá e ver os relatórios e o que tiver com diff anotar e salvar"):
 * acompanha o repo canônico do brain (clone no VPS, /opt/nexo-brain) e grava
 * CADA commit novo como entrada de sinapse no brain local — relatórios,
 * changelog, clientes. A memória da Nexo cresce sozinha, sem ninguém avisar.
 *
 * - Fonte: `ssh vps git log` (BatchMode, timeout curto — falha de SSH não
 *   derruba o job, vira warn e o próximo ciclo pega o diff acumulado);
 * - Estado: .brain/luna/brain-watch-state.json (last_hash + vistos);
 * - Primeira rodada só arma o cursor (sem backfill de histórico antigo);
 * - Áreas notáveis: reports/, clients/, changelog/, personas/, luna/.
 */

const SSH_TARGET = process.env.BRAIN_WATCH_SSH ?? 'vps';
const REMOTE_REPO = process.env.BRAIN_WATCH_REPO ?? '/opt/nexo-brain';
const STATE_FILE = join(BRAIN_ROOT, 'luna', 'brain-watch-state.json');

interface WatchState {
  last_hash: string | null;
  seen: string[];
  armed_at: string | null;
}

interface RemoteCommit {
  hash: string;
  date: string;
  subject: string;
}

function sshGit(args: string[], timeoutMs = 25_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', SSH_TARGET, `git -C ${REMOTE_REPO} ${args.join(' ')}`],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

function loadState(): WatchState {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as WatchState;
  } catch {
    /* estado corrompido recomeça */
  }
  return { last_hash: null, seen: [], armed_at: null };
}

function saveState(s: WatchState): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function synapseFileFor(dateIso: string): string {
  return join(BRAIN_ROOT, 'luna', 'synapses', `${dateIso.slice(0, 7)}.md`);
}

function areaOf(path: string): string {
  const top = path.split('/')[0];
  return ['reports', 'clients', 'changelog', 'personas', 'luna', 'projects', 'knowledge'].includes(top) ? top : 'geral';
}

export function createBrainWatchHandler(deps: { pool: Pool; log: Logger }): JobHandler {
  const { pool, log } = deps;

  return async function brainWatch(job: JobRow): Promise<void> {
    const raw = await sshGit(['log', '--format=%H%x09%ci%x09%s', '-30']);
    const commits: RemoteCommit[] = raw
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [hash = '', date = '', ...rest] = l.split('\t');
        return { hash, date, subject: rest.join('\t') };
      });
    if (!commits.length) {
      log.warn('brain.watch: repo remoto sem commits? (resposta vazia do ssh)');
      return;
    }

    const state = loadState();
    const head = commits[0]!.hash;

    // 1ª rodada: arma o cursor no HEAD atual — diff só daqui pra frente.
    if (!state.last_hash) {
      state.last_hash = head;
      state.armed_at = new Date().toISOString();
      saveState(state);
      const armLine = `- ${new Date().toISOString().slice(0, 10)} · brain.watch ARMADO (cursor em ${head.slice(0, 7)}) · autor: Luna — varredura de diffs do brain canônico ativa: todo commit novo em ${REMOTE_REPO} vira sinapse aqui.\n`;
      appendSynapse(armLine);
      log.info({ head: head.slice(0, 7) }, 'brain.watch: cursor armado — próximos commits viram sinapse');
      await publishEvent(pool, {
        event_type: 'brain.watch.armed', source: 'brain_watch', payload: { head }, idempotency_key: `brainwatch:arm:${head.slice(0, 10)}`,
      });
      return;
    }

    if (state.last_hash === head) {
      log.debug('brain.watch: sem novidade');
      return;
    }

    // commits novos = mais novos que last_hash (a lista vem newest-first).
    const fresh: RemoteCommit[] = [];
    for (const c of commits) {
      if (c.hash === state.last_hash) break;
      if (state.seen.includes(c.hash)) continue;
      fresh.push(c);
    }
    if (!fresh.length) {
      state.last_hash = head;
      saveState(state);
      return;
    }

    // Do mais antigo pro mais novo, com os arquivos tocados.
    const lines: string[] = [];
    for (const c of fresh.reverse()) {
      let files: string[] = [];
      try {
        const names = await sshGit(['show', '--name-only', '--format=', c.hash]);
        files = names.split('\n').filter(Boolean);
      } catch {
        /* diff de arquivos é enfeite — segue sem */
      }
      const areas = [...new Set(files.map(areaOf))].join(', ');
      const day = (c.date || new Date().toISOString()).slice(0, 10);
      lines.push(`- ${day} · brain diff ${c.hash.slice(0, 7)} · autor: Luna — ${c.subject}${areas ? ` [${areas}]` : ''}`);
    }

    appendSynapse(lines.join('\n') + '\n');
    for (const line of lines) {
      await recordActivity(pool, {
        kind: 'info',
        summary: `Brain canônico: ${line.replace(/^- \d{4}-\d{2}-\d{2} · brain diff \w+ · autor: Luna — /, '').slice(0, 180)}`,
      });
    }
    await publishEvent(pool, {
      event_type: 'brain.watch.diff', source: 'brain_watch',
      payload: { commits: fresh.map((c) => c.hash.slice(0, 7)), subjects: fresh.map((c) => c.subject.slice(0, 120)) },
      idempotency_key: `brainwatch:diff:${head.slice(0, 12)}`,
    });

    state.last_hash = head;
    state.seen = [...state.seen, ...fresh.map((c) => c.hash)].slice(-200);
    saveState(state);
    log.info({ novos: fresh.length, head: head.slice(0, 7) }, 'brain.watch: diffs anotados na sinapse');
  };

  function appendSynapse(text: string): void {
    const file = synapseFileFor(new Date().toISOString());
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, { flag: 'a' });
  }
}

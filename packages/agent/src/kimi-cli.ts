import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  KimiAdapterConfig,
  KimiLiveAdapter,
  SessionInfo,
  TurnRequest,
  TurnResult,
} from './types.js';
import { KimiAdapterError } from './types.js';

/**
 * KimiCliAdapter — Cérebro Vivo via `kimi` CLI headless (kimi-code 0.42.0,
 * ADR-033). Fundação da ponte FAST↔LIVE: HANDOFF_LIVE (§6) e o canal admin
 * (P3) rodam o mesmo binário que o time usa, com sessão persistente por
 * diretório de trabalho (`-c/--continue`) e saída NDJSON estável
 * (`--output-format stream-json`).
 *
 * Realidade sondada em 2026-09-22:
 *   kimi -p "<prompt>" --output-format stream-json
 *     → linhas NDJSON; a resposta vem em {"role":"assistant","content":...}
 *       (pode vir em múltiplas linhas — concatenamos), e o session_id em
 *       {"role":"meta","type":"session.resume_hint",...}.
 *   Sessão persistente: rodar com cwd FIXO por session_key e passar -c a
 *     partir do 2º turno (marcador em memória + .session-started no dir).
 *     Sem cwd fixo cada turno seria uma sessão nova.
 *
 * Limites explícitos: sem image_base64 (modo -p não aceita), readMessages
 * devolve [] (o histórico só existe dentro da sessão do CLI).
 */

export interface CliSpawned {
  stdout: AsyncIterable<string | Buffer>;
  stderr: AsyncIterable<string | Buffer>;
  pid?: number;
  kill(signal?: string): void;
  /** Promessa do código de saída. */
  exited: Promise<number>;
}

export interface CliSpawn {
  (cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }): CliSpawned;
}

export interface KimiCliAdapterDeps {
  /** Binário (default "kimi"). */
  bin?: string;
  /** Raiz dos dirs de sessão (default ~/.luna/kimi-cli-sessions). */
  sessionsRoot?: string;
  /** Timeout de parede por turno (default 10 min). */
  timeoutMs?: number;
  /** Autonomia: 'yolo' (-y) ou 'auto' (--auto). Default sem flag (perguntas). */
  autonomy?: 'none' | 'yolo' | 'auto';
  /** Modelo (-m). */
  model?: string;
  /** Spawn injetável (testes não dependem do CLI real). */
  spawnImpl?: CliSpawn;
  /** Clock injetável (testes). */
  now?: () => number;
}

interface StreamJsonLine {
  role?: string;
  type?: string;
  content?: unknown;
  session_id?: string;
}

const sanitize = (key: string): string =>
  key.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'session';

function defaultSpawn(cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }): CliSpawned {
  // Windows: o shim npm do kimi é um .cmd — spawn via cmd /c.
  const full = process.platform === 'win32' ? 'cmd.exe' : cmd;
  const fullArgs = process.platform === 'win32' ? ['/c', cmd, ...args] : args;
  const child = spawn(full, fullArgs, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] });
  return {
    stdout: child.stdout!,
    stderr: child.stderr!,
    pid: child.pid,
    kill: (signal) => {
      if (process.platform === 'win32' && child.pid) {
        try {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } catch {
          child.kill(signal as never);
        }
      } else {
        child.kill(signal as never);
      }
    },
    exited: new Promise<number>((resolve) => child.on('exit', (code) => resolve(code ?? -1))),
  };
}

export class KimiCliAdapter implements KimiLiveAdapter {
  readonly mode = 'kimi-cli' as const;
  private readonly bin: string;
  private readonly sessionsRoot: string;
  private readonly timeoutMs: number;
  private readonly autonomy: 'none' | 'yolo' | 'auto';
  private readonly model?: string;
  private readonly spawnImpl: CliSpawn;
  private readonly now: () => number;
  private readonly started = new Map<string, boolean>();
  /** Fila por session_key: turnos do mesmo thread nunca correm em paralelo. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(_config: KimiAdapterConfig, deps: KimiCliAdapterDeps = {}) {
    this.bin = deps.bin ?? 'kimi';
    this.sessionsRoot =
      deps.sessionsRoot ??
      join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.luna/kimi-cli-sessions');
    this.timeoutMs = deps.timeoutMs ?? 600_000;
    this.autonomy = deps.autonomy ?? 'none';
    this.model = deps.model;
    this.spawnImpl = deps.spawnImpl ?? defaultSpawn;
    this.now = deps.now ?? Date.now;
  }

  private sessionDir(sessionKey: string): string {
    return join(this.sessionsRoot, sanitize(sessionKey));
  }

  async ensureSession(sessionKey: string): Promise<SessionInfo> {
    const dir = this.sessionDir(sessionKey);
    mkdirSync(dir, { recursive: true });
    return { session_id: `kimi-cli:${sanitize(sessionKey)}`, busy: false };
  }

  async sendTurn(request: TurnRequest): Promise<TurnResult> {
    if (request.image_base64) {
      throw new KimiAdapterError('kimi-cli: análise de imagem não suportada no modo -p (use o kimi-api para visão)');
    }
    const prev = this.queues.get(request.session_key) ?? Promise.resolve();
    const run = prev.then(() => this.sendTurnInner(request));
    this.queues.set(request.session_key, run.catch(() => {}));
    return run;
  }

  private async sendTurnInner(request: TurnRequest): Promise<TurnResult> {
    const dir = this.sessionDir(request.session_key);
    mkdirSync(dir, { recursive: true });
    const continuing = this.started.get(request.session_key) === true;
    const args = ['-p', request.prompt, '--output-format', 'stream-json'];
    if (continuing) args.push('-c');
    if (this.autonomy === 'yolo') args.push('-y');
    if (this.autonomy === 'auto') args.push('--auto');
    if (this.model) args.push('-m', this.model);

    const startedAt = this.now();
    const child = this.spawnImpl(this.bin, args, { cwd: dir, env: { ...process.env } as NodeJS.ProcessEnv });
    const { out, err, code, timedOut } = await this.collect(child);

    if (timedOut) {
      throw new KimiAdapterError(
        `kimi-cli: timeout de parede (${Math.round(this.timeoutMs / 1000)}s) no turno da sessão ${sanitize(request.session_key)} — processo morto`,
      );
    }
    if (code !== 0) {
      throw new KimiAdapterError(
        `kimi-cli: exit ${code} (sessão ${sanitize(request.session_key)}): ${err.slice(-300) || 'sem stderr'}`,
      );
    }

    const durationMs = this.now() - startedAt;
    const lines = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    let reply = '';
    let sessionId = `kimi-cli:${sanitize(request.session_key)}`;
    for (const line of lines) {
      let obj: StreamJsonLine;
      try {
        obj = JSON.parse(line) as StreamJsonLine;
      } catch {
        continue; // linhas de log soltas do CLI
      }
      if (obj.role === 'assistant' && typeof obj.content === 'string') reply += obj.content;
      if (obj.role === 'meta' && obj.type === 'session.resume_hint' && obj.session_id) {
        sessionId = obj.session_id;
      }
    }
    if (!reply.trim()) {
      throw new KimiAdapterError(
        `kimi-cli: resposta vazia (exit ok, ${lines.length} linhas stream-json) — o turno pode ter falhado`,
      );
    }
    this.started.set(request.session_key, true);
    try {
      writeFileSync(join(dir, '.session-started'), new Date().toISOString());
    } catch {
      /* marcador é melhor-esforço */
    }
    return {
      reply_text: reply.trim(),
      session_id: sessionId,
      duration_ms: durationMs,
      model: this.model ?? 'kimi-cli',
      provider: 'kimi-cli',
    };
  }

  /** Lê stdout/stderr até o fim OU timeout de parede (mata e devolve já). */
  private async collect(
    child: CliSpawned,
  ): Promise<{ out: string; err: string; code: number; timedOut: boolean }> {
    let timedOut = false;
    const timeoutHit = new Promise<'timeout'>((resolve) => {
      setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
        resolve('timeout');
      }, this.timeoutMs);
    });
    const readStream = async (s: AsyncIterable<string | Buffer>): Promise<string> => {
      let text = '';
      for await (const chunk of s) {
        text += chunk.toString();
      }
      return text;
    };
    // Corrida: processo termina (streams drenam) OU timeout. No timeout não
    // esperamos as streams — o processo morto pode deixá-las pendentes.
    const done = Promise.all([
      readStream(child.stdout).catch(() => ''),
      readStream(child.stderr).catch(() => ''),
      child.exited,
    ])
      .then(([out, err, code]) => ({ out, err, code }))
      .catch(() => ({ out: '', err: '', code: -1 }));
    done.catch(() => {}); // ramo perdedor da corrida nunca vira rejeição solta
    const result = await Promise.race([done, timeoutHit]);
    if (result === 'timeout') {
      return { out: '', err: '', code: -1, timedOut: true };
    }
    return { ...result, timedOut };
  }

  /** Sem acesso ao histórico da sessão do CLI (documentado, ADR-033). */
  async readMessages(_sessionKey: string, _afterSeq?: number): Promise<unknown[]> {
    return [];
  }
}

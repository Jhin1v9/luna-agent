import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type {
  KimiAdapterConfig,
  KimiLiveAdapter,
  SessionInfo,
  TurnRequest,
  TurnResult,
} from './types.js';
import { KimiAdapterError } from './types.js';
import type { CliSpawn, CliSpawned } from './kimi-cli.js';

/**
 * PiAdapter — Cérebro Vivo RESERVA via `pi` CLI headless (pi-coding-agent,
 * MIT, ADR-039). Entra quando o Kimi CLI (primário do live brain) está sem
 * quota: LIVE_BRAIN_PROVIDER=pi no .env troca o live brain sem tocar em código.
 *
 * Mesma interface estável (`ensureSession/sendTurn/readMessages`) dos demais
 * adapters — o worker (investigate + canal admin) programa contra
 * `KimiLiveAdapter`, então a troca é só wiring.
 *
 * Realidade sondada ao vivo (2026-09-23, pi 0.87.1):
 *   · `pi -p "<prompt>"` roda one-shot e imprime a resposta na stdout.
 *   · Exit 0 NÃO garante resposta: com quota esgotada o pi imprime o JSON do
 *     erro (`permission_error`/usage limit) e sai 0 — por isso o stdout é
 *     varrido por padrão de erro de quota e tratado como FALHA explícita
 *     (nunca entregar texto de erro como resposta de cliente).
 *   · Windows: o shim npm (.cmd) quebra prompts longos (mesma evidência do
 *     kimi-cli, ADR-033) — o caminho certo é spawnar o node direto no
 *     entrypoint real do pacote (argv UTF-16).
 *   · Provider do pi é conta do operador (`pi` → /login → NVIDIA NIM — ação
 *     humana, ADR-039); o adapter não configura auth, só falha explícito.
 *
 * Todo turno leva o onboarding (regras de ouro) no prompt — sessões pi -p
 * são one-shot, então o contexto de guardrail via no prompt de CADA turno.
 */

export interface PiAdapterDeps {
  /** Binário (default "pi" — usado só no fallback de shim). */
  bin?: string;
  /** Entrypoint cli.js do pacote (default: global npm do usuário; override via PI_ENTRY). */
  entry?: string;
  /** Raiz dos dirs de sessão (default ~/.luna/pi-sessions). */
  sessionsRoot?: string;
  /** Timeout de parede por turno (default 10 min). */
  timeoutMs?: number;
  /** Arquivo de onboarding prepended no prompt de todo turno. */
  onboardingFile?: string;
  /** Spawn injetável (testes não dependem do CLI real). */
  spawnImpl?: CliSpawn;
  /** Clock injetável (testes). */
  now?: () => number;
}

/** Erro de quota devolvido pelo provider dentro do stdout com exit 0. */
const PROVIDER_ERROR_RE = /"permission_error"|"rate_limit"|usage limit|quota (exceeded|will reset)|insufficient_quota|rate limit exceeded/i;

const sanitize = (key: string): string =>
  key.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'session';

function defaultSpawn(cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }): CliSpawned {
  const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
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
    exited: new Promise<number>((resolveExit) => child.on('exit', (code) => resolveExit(code ?? -1))),
  };
}

export class PiAdapter implements KimiLiveAdapter {
  readonly mode = 'pi' as const;
  private readonly bin: string;
  private readonly entry: string | null;
  private readonly sessionsRoot: string;
  private readonly timeoutMs: number;
  private readonly onboardingFile: string | undefined;
  private onboardingCache: string | null | undefined;
  private readonly spawnImpl: CliSpawn;
  private readonly now: () => number;
  /** Fila por session_key: turnos do mesmo thread nunca correm em paralelo. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(_config: KimiAdapterConfig, deps: PiAdapterDeps = {}) {
    this.bin = deps.bin ?? 'pi';
    const defaultEntry = join(
      process.env.APPDATA ?? '',
      'npm',
      'node_modules',
      '@earendil-works',
      'pi-coding-agent',
      'dist',
      'bundle',
      'cli.js',
    );
    const entry = deps.entry ?? process.env.PI_ENTRY ?? defaultEntry;
    this.entry = existsSync(entry) ? entry : null;
    this.sessionsRoot =
      deps.sessionsRoot ??
      join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.luna/pi-sessions');
    this.timeoutMs = deps.timeoutMs ?? 600_000;
    this.onboardingFile = deps.onboardingFile;
    this.spawnImpl = deps.spawnImpl ?? defaultSpawn;
    this.now = deps.now ?? Date.now;
  }

  /** Onboarding resolvido do cwd para cima (mesma convenção do loadDotEnv). */
  private onboarding(): string {
    if (this.onboardingCache !== undefined) return this.onboardingCache ?? '';
    let file = this.onboardingFile;
    if (!file) {
      let dir = process.cwd();
      for (;;) {
        const candidate = resolve(dir, 'ONBOARDING-LIVE-BRAIN-PI.md');
        if (existsSync(candidate)) {
          file = candidate;
          break;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
    try {
      this.onboardingCache = file && existsSync(file) ? readFileSync(file, 'utf8') : null;
    } catch {
      this.onboardingCache = null;
    }
    return this.onboardingCache ?? '';
  }

  private sessionDir(sessionKey: string): string {
    return join(this.sessionsRoot, sanitize(sessionKey));
  }

  async ensureSession(sessionKey: string): Promise<SessionInfo> {
    mkdirSync(this.sessionDir(sessionKey), { recursive: true });
    return { session_id: `pi:${sanitize(sessionKey)}`, busy: false };
  }

  async sendTurn(request: TurnRequest): Promise<TurnResult> {
    if (request.image_base64) {
      throw new KimiAdapterError('pi: análise de imagem não suportada no modo -p (use o fast brain para visão)');
    }
    const prev = this.queues.get(request.session_key) ?? Promise.resolve();
    const run = prev.then(() => this.sendTurnInner(request));
    this.queues.set(request.session_key, run.catch(() => {}));
    return run;
  }

  private async sendTurnInner(request: TurnRequest): Promise<TurnResult> {
    const dir = this.sessionDir(request.session_key);
    mkdirSync(dir, { recursive: true });

    // Guardrail de ouro em TODO turno: o pi -p é one-shot, não há memória de
    // sistema entre invocações — o onboarding via junto do prompt.
    const onboarding = this.onboarding();
    const fullPrompt = onboarding
      ? `${onboarding}\n\n---\n\n${request.prompt}`
      : request.prompt;

    const args = ['-p', fullPrompt];
    // Windows: node no entrypoint real (sem shim .cmd — prompts longos).
    const child = this.entry
      ? this.spawnImpl(process.execPath, [this.entry, ...args], { cwd: dir, env: { ...process.env } as NodeJS.ProcessEnv })
      : this.spawnImpl(
          process.platform === 'win32' ? 'cmd.exe' : this.bin,
          process.platform === 'win32' ? ['/c', this.bin, ...args] : args,
          { cwd: dir, env: { ...process.env } as NodeJS.ProcessEnv },
        );

    const startedAt = this.now();
    const { out, err, code, timedOut } = await this.collect(child);

    if (timedOut) {
      throw new KimiAdapterError(
        `pi: timeout de parede (${Math.round(this.timeoutMs / 1000)}s) no turno da sessão ${sanitize(request.session_key)} — processo morto`,
      );
    }
    if (code !== 0) {
      throw new KimiAdapterError(
        `pi: exit ${code} (sessão ${sanitize(request.session_key)}): ${err.slice(-300) || out.slice(-300) || 'sem saída'}`,
      );
    }

    const reply = out.trim();
    // Exit 0 com JSON de erro de quota no stdout = provider falhou, não respondeu.
    if (!reply) {
      throw new KimiAdapterError(`pi: resposta vazia (exit ok). Raw: ${out.slice(-600) || err.slice(-300)}`);
    }
    if (PROVIDER_ERROR_RE.test(reply) && reply.length < 800) {
      throw new KimiAdapterError(`pi: provider sem quota/acesso — ${reply.slice(0, 400)}`);
    }

    return {
      reply_text: reply,
      session_id: `pi:${sanitize(request.session_key)}`,
      duration_ms: this.now() - startedAt,
      model: 'pi',
      provider: 'pi',
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
    const done = Promise.all([
      readStream(child.stdout).catch(() => ''),
      readStream(child.stderr).catch(() => ''),
      child.exited,
    ])
      .then(([out, err, code]) => ({ out, err, code }))
      .catch(() => ({ out: '', err: '', code: -1 }));
    done.catch(() => {});
    const result = await Promise.race([done, timeoutHit]);
    if (result === 'timeout') {
      return { out: '', err: '', code: -1, timedOut: true };
    }
    return { ...result, timedOut };
  }

  /** Sem acesso ao histórico da sessão do CLI (documentado, mesmo contrato do kimi-cli). */
  async readMessages(_sessionKey: string, _afterSeq?: number): Promise<unknown[]> {
    return [];
  }
}

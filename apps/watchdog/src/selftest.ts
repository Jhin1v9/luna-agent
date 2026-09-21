import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Pool } from 'pg';
import { sendTeamMessage, type TelegramConfig } from '@luna/channels';
import { recordActivity } from '@luna/database';
import type { KimiLiveAdapter } from '@luna/agent';
import type { Logger } from 'pino';

const execFileP = promisify(execFile);

/**
 * Self-test periódico (§20): Luna testa a si mesma — DB, Brain, Kimi API,
 * WhatsPlay, browser, Git, storage. Corrige o que pode (restart via watchdog),
 * alerta o que não pode. Rodada agendada (6h) + ao boot. Resultados em
 * activity_log.
 */

export interface SelfTestResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function checkDb(pool: Pool): Promise<SelfTestResult> {
  try {
    await pool.query('SELECT 1');
    return { name: 'db', ok: true, detail: 'SELECT 1 ok' };
  } catch (err) {
    return { name: 'db', ok: false, detail: String(err).slice(0, 120) };
  }
}

async function checkBrain(): Promise<SelfTestResult> {
  try {
    const { existsSync, readdirSync } = await import('node:fs');
    const brain = 'C:/Users/Abner/Documents/Luna cto/luna-agent/.brain';
    if (!existsSync(brain)) return { name: 'brain', ok: false, detail: '.brain não existe' };
    const files = readdirSync(`${brain}/luna/selectors`);
    return { name: 'brain', ok: files.length > 0, detail: `selector memory com ${files.length} arquivo(s)` };
  } catch (err) {
    return { name: 'brain', ok: false, detail: String(err).slice(0, 120) };
  }
}

async function checkKimi(adapter: KimiLiveAdapter): Promise<SelfTestResult> {
  try {
    const r = await adapter.sendTurn({ session_key: 'selftest', prompt: 'Responda apenas: ok' });
    return { name: 'kimi-api', ok: r.reply_text.length > 0, detail: `${r.duration_ms}ms` };
  } catch (err) {
    return { name: 'kimi-api', ok: false, detail: String(err).slice(0, 120) };
  }
}

async function checkGit(): Promise<SelfTestResult> {
  try {
    await execFileP('git', ['-C', 'C:/Users/Abner/Documents/Luna cto/luna-agent', 'rev-parse', '--short', 'HEAD'], { timeout: 10_000 });
    return { name: 'git', ok: true, detail: 'repo acessível' };
  } catch (err) {
    return { name: 'git', ok: false, detail: String(err).slice(0, 120) };
  }
}

async function checkStorage(): Promise<SelfTestResult> {
  try {
    const statfs = await import('node:fs/promises').then((m) => m.statfs);
    const s = await statfs('C:/Users/Abner/Documents/Luna cto/luna-agent');
    const freePct = (s.bavail / s.blocks) * 100;
    return {
      name: 'storage',
      ok: freePct > 10,
      detail: `${freePct.toFixed(1)}% livre (${s.bavail > 0 ? 'ok' : 'cheio!'})`,
    };
  } catch (err) {
    return { name: 'storage', ok: false, detail: String(err).slice(0, 120) };
  }
}

export async function runSelfTest(deps: {
  pool: Pool;
  adapter: KimiLiveAdapter;
  log: Logger;
  telegram?: TelegramConfig;
  /** Saúde conhecida do watchdog (whatsplay/browser já avaliados no ciclo). */
  whatsplayState?: string;
  chromeAlive?: boolean;
}): Promise<SelfTestResult[]> {
  const results: SelfTestResult[] = [];
  results.push(await checkDb(deps.pool));
  results.push(await checkBrain());
  results.push(await checkGit());
  results.push(await checkStorage());
  results.push({
    name: 'whatsplay',
    ok: deps.whatsplayState === 'HEALTHY',
    detail: `estado ${deps.whatsplayState ?? '?'}`,
  });
  results.push({
    name: 'browser',
    ok: deps.chromeAlive !== false,
    detail: deps.chromeAlive === false ? 'Chrome dedicado morto' : 'ok',
  });
  try {
    results.push(await checkKimi(deps.adapter));
  } catch (err) {
    results.push({ name: 'kimi-api', ok: false, detail: String(err).slice(0, 120) });
  }

  const failed = results.filter((r) => !r.ok);
  await recordActivity(deps.pool, {
    kind: failed.length > 0 ? 'incident' : 'info',
    summary:
      failed.length > 0
        ? `Self-test: ${results.length - failed.length}/${results.length} ok — falhas: ${failed.map((f) => f.name).join(', ')}.`
        : `Self-test: tudo ok (${results.map((r) => r.name).join(', ')}).`,
  }).catch(() => {});

  if (failed.length > 0) {
    deps.log.error({ failed }, 'self-test: falhas detectadas');
    if (deps.telegram?.botToken && deps.telegram.teamChatId) {
      try {
        await sendTeamMessage(
          `🔬 Self-test da Luna: ${failed.length} falha(s) — ${failed.map((f) => `${f.name}: ${f.detail}`).join(' | ')}`,
          deps.telegram,
        );
      } catch {
        deps.log.error('self-test: alerta Telegram falhou (token ausente ou erro)');
      }
    }
  } else {
    deps.log.info('self-test: tudo ok');
  }
  return results;
}

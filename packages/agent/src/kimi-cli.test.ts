import { describe, expect, it, vi } from 'vitest';
import { KimiCliAdapter, type CliSpawn, type CliSpawned } from './kimi-cli.js';
import { KimiAdapterError } from './types.js';

/**
 * Testes com o processo INJETADO — nada de rede ou CLI real aqui.
 * O smoke real com o binário local fica fora da suíte (ADR-033).
 */

const STREAM = (lines: string[]) =>
  (async function* () {
    for (const l of lines) yield Buffer.from(l + '\n');
  })();

function fakeChild(opts: {
  stdout?: string[];
  stderr?: string[];
  code?: number;
  hang?: boolean;
  onKill?: () => void;
}): CliSpawned & { killed: boolean } {
  const child = {
    killed: false,
    stdout: opts.hang
      ? (async function* () {
          yield Buffer.from('');
          await new Promise(() => {});
        })()
      : STREAM(opts.stdout ?? []),
    stderr: STREAM(opts.stderr ?? []),
    pid: 4321,
    kill: () => {
      child.killed = true;
      opts.onKill?.();
    },
    exited: opts.hang
      ? new Promise<number>((resolve) => {
          const userOnKill = opts.onKill;
          opts.onKill = () => {
            userOnKill?.();
            resolve(-1);
          };
        })
      : Promise.resolve(opts.code ?? 0),
  };
  return child;
}

function makeAdapter(spawnImpl: CliSpawn, extra: ConstructorParameters<typeof KimiCliAdapter>[1] = {}) {
  return new KimiCliAdapter({ mode: 'kimi-cli' }, { spawnImpl, sessionsRoot: '/tmp/kimi-cli-test', ...extra });
}

describe('KimiCliAdapter (ADR-033 — CLI headless, spawn injetado)', () => {
  it('parse stream-json: concatena linhas assistant e captura session_id', async () => {
    const calls: string[][] = [];
    const adapter = makeAdapter((cmd, args) => {
      calls.push(args);
      return fakeChild({
        stdout: [
          '{"role":"meta","type":"system.version","version":"0.42.0"}',
          '{"role":"assistant","content":"Resposta "}',
          '{"role":"assistant","content":"completa."}',
          '{"role":"meta","type":"session.resume_hint","session_id":"session_abc","command":"kimi -r session_abc"}',
        ],
      });
    });
    const r = await adapter.sendTurn({ session_key: 'conv-1', prompt: 'oi' });
    expect(r.reply_text).toBe('Resposta completa.');
    expect(r.session_id).toBe('session_abc');
    expect(r.provider).toBe('kimi-cli');
    // 1º turno: SEM -c (sessão nova)
    expect(calls[0]).not.toContain('-c');
  });

  it('2º turno da MESMA session_key usa -c (sessão persistente por cwd)', async () => {
    const calls: string[][] = [];
    const adapter = makeAdapter((_cmd, args) => {
      calls.push([...args]);
      return fakeChild({ stdout: ['{"role":"assistant","content":"ok"}'] });
    });
    await adapter.sendTurn({ session_key: 'conv-1', prompt: 'turno 1' });
    await adapter.sendTurn({ session_key: 'conv-1', prompt: 'turno 2' });
    expect(calls[0]).not.toContain('-c');
    expect(calls[1]).toContain('-c');
  });

  it('session_keys diferentes não se enfileiram juntas e não compartilham sessão', async () => {
    const calls: Array<{ key: string; args: string[] }> = [];
    const adapter = makeAdapter((_cmd, args, opts) => {
      calls.push({ key: opts.cwd, args: [...args] });
      return fakeChild({ stdout: ['{"role":"assistant","content":"ok"}'] });
    });
    await adapter.sendTurn({ session_key: 'a', prompt: 'x' });
    await adapter.sendTurn({ session_key: 'b', prompt: 'y' });
    expect(calls[0]!.key).not.toBe(calls[1]!.key);
    // nenhum dos dois usa -c (sessões novas)
    expect(calls.every((c) => !c.args.includes('-c'))).toBe(true);
  });

  it('turnos da mesma session_key são SERIALIZADOS (fila)', async () => {
    const ordem: string[] = [];
    const adapter = makeAdapter((_cmd, args) => {
      const prompt = args[args.indexOf('-p') + 1]!;
      ordem.push(`start:${prompt}`);
      return fakeChild({
        stdout: ['{"role":"assistant","content":"ok"}'],
      });
    });
    await Promise.all([
      adapter.sendTurn({ session_key: 's', prompt: 'primeiro' }),
      adapter.sendTurn({ session_key: 's', prompt: 'segundo' }),
    ]);
    expect(ordem).toEqual(['start:primeiro', 'start:segundo']);
  });

  it('exit != 0 → KimiAdapterError com stderr (explícito, nunca silêncio)', async () => {
    const adapter = makeAdapter(() =>
      fakeChild({ stdout: [], stderr: ['boom: auth failed'], code: 1 }),
    );
    await expect(adapter.sendTurn({ session_key: 'x', prompt: 'p' })).rejects.toThrow(/exit 1.*auth failed/s);
  });

  it('timeout de parede: mata o processo e erro explícito', async () => {
    vi.useFakeTimers();
    try {
      let killed = false;
      const adapter = makeAdapter(
        () =>
          fakeChild({
            hang: true,
            onKill: () => {
              killed = true;
            },
          }),
        { timeoutMs: 1_000 },
      );
      const p = adapter.sendTurn({ session_key: 'x', prompt: 'p' });
      const assertion = expect(p).rejects.toThrow(/timeout de parede/);
      await vi.advanceTimersByTimeAsync(1_500);
      await assertion;
      expect(killed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resposta vazia com exit 0 → erro explícito', async () => {
    const adapter = makeAdapter(() => fakeChild({ stdout: ['{"role":"meta","type":"system.version"}'] }));
    await expect(adapter.sendTurn({ session_key: 'x', prompt: 'p' })).rejects.toThrow(/resposta vazia/);
  });

  it('image_base64 → erro explícito (modo -p não suporta visão)', async () => {
    const adapter = makeAdapter(() => fakeChild({}));
    await expect(
      adapter.sendTurn({ session_key: 'x', prompt: 'p', image_base64: 'AAAA' }),
    ).rejects.toThrow(/imagem não suportada/);
  });

  it('readMessages devolve [] (documentado ADR-033)', async () => {
    const adapter = makeAdapter(() => fakeChild({}));
    expect(await adapter.readMessages('qualquer')).toEqual([]);
  });

  it('autonomia yolo/auto e model chegam como flags', async () => {
    const calls: string[][] = [];
    const adapter = makeAdapter(
      (_cmd, args) => {
        calls.push([...args]);
        return fakeChild({ stdout: ['{"role":"assistant","content":"ok"}'] });
      },
      { autonomy: 'yolo', model: 'k2.6' },
    );
    await adapter.sendTurn({ session_key: 'x', prompt: 'p' });
    expect(calls[0]).toContain('-y');
    expect(calls[0]).toContain('k2.6');
  });
});

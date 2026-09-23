import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiAdapter } from './pi.js';
import type { CliSpawn, CliSpawned } from './kimi-cli.js';

/** Spawn mock: resposta pronta na stdout, exit configurável. */
function fakeSpawn(out: string, err = '', code = 0): CliSpawn {
  const impl: CliSpawn = () => {
    async function* stream(text: string): AsyncIterable<string> {
      yield text;
    }
    return {
      stdout: stream(out),
      stderr: stream(err),
      pid: 1234,
      kill: () => {},
      exited: Promise.resolve(code),
    };
  };
  return impl;
}

/** Cria um cli.js FAKE mas real em disco (o adapter testa existsSync no entry). */
function makeFakeEntry(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pi-entry-'));
  const entry = join(dir, 'cli.js');
  writeFileSync(entry, '// fake pi entry\n');
  return entry;
}

describe('PiAdapter (live brain reserva, ADR-039)', () => {
  it('sendTurn executa pi -p com o prompt e devolve stdout como resposta', async () => {
    let seenArgs: string[] = [];
    const entry = makeFakeEntry();
    const spawnImpl: CliSpawn = (cmd, args) => {
      seenArgs = args;
      expect(cmd).toBe(process.execPath); // node direto no entrypoint (sem shim .cmd)
      return fakeSpawn('Investigação concluída: 7 arquivos.')('node', [], { cwd: '', env: {} });
    };
    const a = new PiAdapter({ mode: 'pi' }, { spawnImpl, entry });
    const r = await a.sendTurn({ session_key: 'inv:1', prompt: 'TAREFA: conte arquivos' });
    expect(seenArgs[0]).toBe(entry);
    expect(seenArgs[1]).toBe('-p');
    expect(seenArgs[2]).toContain('TAREFA: conte arquivos');
    expect(r.reply_text).toBe('Investigação concluída: 7 arquivos.');
    expect(r.provider).toBe('pi');
    expect(r.session_id).toBe('pi:inv_1');
  });

  it('onboarding é prepended no prompt de todo turno (guardrail de ouro)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-test-'));
    const onboardingPath = join(dir, 'ONBOARDING.md');
    writeFileSync(onboardingPath, '# ONBOARDING\nREGRAS DE OURO do teste.');
    let prompt = '';
    const spawnImpl: CliSpawn = (_cmd, args) => {
      prompt = args[2]!;
      return fakeSpawn('ok')('node', [], { cwd: '', env: {} });
    };
    const a = new PiAdapter(
      { mode: 'pi' },
      { spawnImpl, entry: makeFakeEntry(), onboardingFile: onboardingPath },
    );
    await a.sendTurn({ session_key: 'x', prompt: 'tarefa' });
    expect(prompt).toMatch(/^# ONBOARDING\nREGRAS DE OURO do teste\./);
    expect(prompt).toContain('tarefa');
  });

  it('exit != 0 → KimiAdapterError com stderr (falha explícita, nunca silêncio)', async () => {
    const a = new PiAdapter({ mode: 'pi' }, {
      spawnImpl: fakeSpawn('', 'provider not configured', 1),
      entry: 'C:/fake/pi/cli.js',
    });
    await expect(a.sendTurn({ session_key: 'x', prompt: 'p' })).rejects.toThrow(/exit 1/);
    await expect(a.sendTurn({ session_key: 'x', prompt: 'p' })).rejects.toThrow(/provider not configured/);
  });

  it('exit 0 com JSON de quota no stdout → FALHA explícita (nunca entrega erro como resposta)', async () => {
    const quotaJson = '{"error":{"type":"permission_error","message":"You\'ve reached your weekly usage limit..."}}';
    const a = new PiAdapter({ mode: 'pi' }, {
      spawnImpl: fakeSpawn(quotaJson, '', 0),
      entry: 'C:/fake/pi/cli.js',
    });
    await expect(a.sendTurn({ session_key: 'x', prompt: 'p' })).rejects.toThrow(/sem quota/);
  });

  it('stdout vazio com exit 0 → erro explícito', async () => {
    const a = new PiAdapter({ mode: 'pi' }, {
      spawnImpl: fakeSpawn('   ', '', 0),
      entry: 'C:/fake/pi/cli.js',
    });
    await expect(a.sendTurn({ session_key: 'x', prompt: 'p' })).rejects.toThrow(/resposta vazia/);
  });

  it('image_base64 é recusado (modo -p não aceita visão)', async () => {
    const a = new PiAdapter({ mode: 'pi' }, { spawnImpl: fakeSpawn('x'), entry: 'C:/fake/pi/cli.js' });
    await expect(
      a.sendTurn({ session_key: 'x', prompt: 'p', image_base64: 'AAAA' }),
    ).rejects.toThrow(/imagem não suportada/);
  });

  it('timeout de parede mata o processo e falha explícito', async () => {
    const slow: CliSpawn = () => ({
      stdout: (async function* () {
        await new Promise(() => {}); // nunca termina
      })(),
      stderr: (async function* () {})(),
      pid: 42,
      kill: () => {},
      exited: new Promise(() => {}),
    });
    const a = new PiAdapter({ mode: 'pi' }, {
      spawnImpl: slow,
      entry: 'C:/fake/pi/cli.js',
      timeoutMs: 50,
    });
    await expect(a.sendTurn({ session_key: 'x', prompt: 'p' })).rejects.toThrow(/timeout de parede/);
  });

  it('sessão é nominal e stateless (mesmo contrato dos demais adapters)', async () => {
    const a = new PiAdapter({ mode: 'pi' }, { spawnImpl: fakeSpawn('ok'), entry: 'C:/fake/pi/cli.js' });
    const s = await a.ensureSession('conv:9');
    expect(s.session_id).toBe('pi:conv_9');
    expect(await a.readMessages('conv:9')).toEqual([]);
  });
});

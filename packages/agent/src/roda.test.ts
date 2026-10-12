import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { RodaAdapter, RodaConfigMissing } from './roda.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface ProviderSpec {
  id: string;
  transport?: string;
  baseUrl: string;
  apiKeyEnv: string | null;
  model?: string;
  enabled?: boolean;
  priority: number;
}

function writeConfig(providers: ProviderSpec[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'roda-test-'));
  const path = join(dir, 'providers.json');
  writeFileSync(
    path,
    JSON.stringify({
      fastBrain: 'teste',
      liveBrain: 'teste',
      providers: providers.map((p) => ({
        label: p.id,
        transport: 'openai',
        model: 'modelo-x',
        enabled: true,
        ...p,
      })),
    }),
  );
  return path;
}

function silentLog() {
  return {
    warn: (_obj: unknown, _msg?: string) => {},
    info: () => {},
    error: () => {},
  } as never;
}

const TURN = { session_key: 'conv-1', prompt: 'persona + contexto + oi' };

describe('RodaAdapter (fast brain na roda de providers, ADR-041)', () => {
  it('escolhe por priority e devolve provider real + usage', async () => {
    const configPath = writeConfig([
      { id: 'lento', baseUrl: 'https://lento.test/v1', apiKeyEnv: null, priority: 20 },
      { id: 'rapido', baseUrl: 'https://rapido.test/v1', apiKeyEnv: null, priority: 2 },
    ]);
    const seen: string[] = [];
    const a = new RodaAdapter(
      { mode: 'roda' },
      {
        configPath,
        log: silentLog(),
        fetchImpl: async (url) => {
          seen.push(url);
          return jsonResponse({
            choices: [{ message: { content: 'resposta do rapido' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          });
        },
      },
    );
    const r = await a.sendTurn(TURN);
    expect(seen).toEqual(['https://rapido.test/v1/chat/completions']);
    expect(r.reply_text).toBe('resposta do rapido');
    expect(r.provider).toBe('rapido');
    expect(r.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it('usa Authorization Bearer com a key lida do env pelo nome apiKeyEnv', async () => {
    process.env.RODA_TEST_KEY = 'segredo-de-teste';
    const configPath = writeConfig([
      { id: 'comkey', baseUrl: 'https://comkey.test/v1', apiKeyEnv: 'RODA_TEST_KEY', priority: 1 },
    ]);
    let init: RequestInit | undefined;
    const a = new RodaAdapter(
      { mode: 'roda' },
      {
        configPath,
        log: silentLog(),
        fetchImpl: async (_url, i) => {
          init = i;
          return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
        },
      },
    );
    await a.sendTurn(TURN);
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer segredo-de-teste');
    delete process.env.RODA_TEST_KEY;
  });

  it('pula provider com key ausente, com log, e segue pro próximo', async () => {
    delete process.env.RODA_FALTA_KEY;
    const warns: string[] = [];
    const configPath = writeConfig([
      { id: 'semkey', baseUrl: 'https://semkey.test/v1', apiKeyEnv: 'RODA_FALTA_KEY', priority: 1 },
      { id: 'semauth', baseUrl: 'https://semauth.test/v1', apiKeyEnv: null, priority: 2 },
    ]);
    const seen: string[] = [];
    const a = new RodaAdapter(
      { mode: 'roda' },
      {
        configPath,
        log: {
          warn: (obj: unknown, msg?: string) => {
            warns.push(`${(obj as { roda?: string }).roda ?? ''} ${msg ?? ''}`);
          },
          info: () => {},
          error: () => {},
        } as never,
        fetchImpl: async (url) => {
          seen.push(url);
          return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
        },
      },
    );
    const r = await a.sendTurn(TURN);
    expect(seen).toEqual(['https://semauth.test/v1/chat/completions']);
    expect(r.provider).toBe('semauth');
    expect(warns.some((w) => w.includes('semkey') && w.includes('key ausente'))).toBe(true);
  });

  it('cooldown após falha: provider morto é pulado e o próximo responde', async () => {
    const configPath = writeConfig([
      { id: 'morto', baseUrl: 'https://morto.test/v1', apiKeyEnv: null, priority: 1 },
      { id: 'vivo', baseUrl: 'https://vivo.test/v1', apiKeyEnv: null, priority: 2 },
    ]);
    let t = 0;
    const seen: string[] = [];
    const a = new RodaAdapter(
      { mode: 'roda' },
      {
        configPath,
        log: silentLog(),
        now: () => t,
        fetchImpl: async (url) => {
          seen.push(url);
          if (url.startsWith('https://morto')) return jsonResponse({ error: 'boom' }, 500);
          return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
        },
      },
    );
    const r1 = await a.sendTurn(TURN);
    expect(r1.provider).toBe('vivo');
    expect(seen.filter((u) => u.startsWith('https://morto'))).toHaveLength(3); // 1 + 2 retries
    // Segundo turno logo em seguida: morto em cooldown (60s), só vivo.
    const antes = seen.length;
    const r2 = await a.sendTurn(TURN);
    expect(r2.provider).toBe('vivo');
    expect(seen.length).toBe(antes + 1);
    // Depois do cooldown, morto é tentado de novo.
    t += 61_000;
    await a.sendTurn(TURN);
    expect(seen.filter((u) => u.startsWith('https://morto'))).toHaveLength(6);
  });

  it('erro acumulado (causas sem key) quando todos falham', async () => {
    process.env.RODA_K1 = 'k1-secreta';
    const configPath = writeConfig([
      { id: 'a', baseUrl: 'https://a.test/v1', apiKeyEnv: 'RODA_K1', priority: 1 },
      { id: 'b', baseUrl: 'https://b.test/v1', apiKeyEnv: null, priority: 2 },
    ]);
    const a = new RodaAdapter(
      { mode: 'roda' },
      {
        configPath,
        log: silentLog(),
        fetchImpl: async (url) =>
          url.startsWith('https://a')
            ? jsonResponse({ error: 'server error' }, 500)
            : Promise.reject(new Error('ECONNREFUSED')),
      },
    );
    try {
      await a.sendTurn(TURN);
      expect.unreachable();
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toMatch(/todos os providers falharam/);
      expect(msg).toMatch(/a: HTTP 500/);
      expect(msg).toMatch(/b: inacessível/);
      expect(msg).not.toMatch(/k1-secreta/);
    }
    delete process.env.RODA_K1;
  });

  it('config inexistente: falha explícita pedindo o painel', () => {
    expect(() => new RodaAdapter({ mode: 'roda' }, { configPath: '/nao/existe/providers.json', log: silentLog() })).toThrow(
      RodaConfigMissing,
    );
    expect(() => new RodaAdapter({ mode: 'roda' }, { configPath: '/nao/existe/providers.json', log: silentLog() })).toThrow(
      /painel/,
    );
  });

  it('ignora providers desabilitados e de transport não-openai', async () => {
    const configPath = writeConfig([
      { id: 'fcc-local', baseUrl: 'http://127.0.0.1:8082', apiKeyEnv: null, priority: 1, transport: 'fcc-local' },
      { id: 'off', baseUrl: 'https://off.test/v1', apiKeyEnv: null, priority: 2, enabled: false },
      { id: 'on', baseUrl: 'https://on.test/v1', apiKeyEnv: null, priority: 3 },
    ]);
    const seen: string[] = [];
    const a = new RodaAdapter(
      { mode: 'roda' },
      {
        configPath,
        log: silentLog(),
        fetchImpl: async (url) => {
          seen.push(url);
          return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
        },
      },
    );
    await a.sendTurn(TURN);
    expect(seen).toEqual(['https://on.test/v1/chat/completions']);
  });
});

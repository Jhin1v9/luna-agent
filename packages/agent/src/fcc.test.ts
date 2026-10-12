import { describe, it, expect } from 'vitest';
import { FccAdapter } from './fcc.js';
import { KimiAdapterError } from './types.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('FccAdapter (live brain via FCC local, ADR-041)', () => {
  it('sendTurn POST /v1/messages estilo Anthropic e mapeia choices/usage', async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return jsonResponse({
        choices: [{ message: { content: 'Investigação concluída pelo FCC.' } }],
        usage: { input_tokens: 120, output_tokens: 42 },
      });
    };
    const a = new FccAdapter({ fetchImpl });
    const r = await a.sendTurn({ session_key: 'handoff-1', prompt: 'investigue o deploy' });

    expect(a.mode).toBe('fcc');
    expect(seen!.url).toBe('http://127.0.0.1:8082/v1/messages');
    const headers = seen!.init?.headers as Record<string, string>;
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers.authorization).toBeUndefined();
    const body = JSON.parse(String(seen!.init?.body)) as {
      model: string;
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('nvidia_nim/moonshotai/kimi-k3');
    expect(body.max_tokens).toBe(4096);
    expect(body.messages).toEqual([{ role: 'user', content: 'investigue o deploy' }]);
    expect(r.reply_text).toContain('FCC');
    expect(r.session_id).toBe('fcc');
    expect(r.provider).toBe('fcc');
    expect(r.usage).toEqual({ input_tokens: 120, output_tokens: 42 });
  });

  it('modelo overridável via FCC_MODEL', async () => {
    process.env.FCC_MODEL = 'outro/modelo';
    let seen: { init?: RequestInit } | null = null;
    const a = new FccAdapter({
      fetchImpl: async (_url, init) => {
        seen = { init };
        return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
      },
    });
    await a.sendTurn({ session_key: 'k', prompt: 'p' });
    expect((JSON.parse(String(seen!.init?.body)) as { model: string }).model).toBe('outro/modelo');
    delete process.env.FCC_MODEL;
  });

  it('401 falha explícita pedindo pra checar o FCC (sem auth por default)', async () => {
    const a = new FccAdapter({ fetchImpl: async () => jsonResponse({ error: 'unauthorized' }, 401) });
    await expect(a.sendTurn({ session_key: 'k', prompt: 'p' })).rejects.toThrow(/401/);
    await expect(a.sendTurn({ session_key: 'k', prompt: 'p' })).rejects.toThrow(/FCC/);
  });

  it('falha de rede: erro com causa (FCC caido?)', async () => {
    const a = new FccAdapter({
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    try {
      await a.sendTurn({ session_key: 'k', prompt: 'p' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(KimiAdapterError);
      expect((err as Error).message).toMatch(/inacessível/);
    }
  });

  it('resposta sem content falha explícita', async () => {
    const a = new FccAdapter({ fetchImpl: async () => jsonResponse({ usage: {} }) });
    await expect(a.sendTurn({ session_key: 'k', prompt: 'p' })).rejects.toThrow(/choices/);
  });

  it('ensureSession é stateless e readMessages é vazio', async () => {
    const a = new FccAdapter({ fetchImpl: async () => jsonResponse({}) });
    expect(await a.ensureSession('qualquer')).toEqual({ session_id: 'fcc', busy: false });
    expect(await a.readMessages('qualquer')).toEqual([]);
  });
});

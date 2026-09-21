import { describe, it, expect } from 'vitest';
import { KimiApiAdapter, KimiApiError, KimiApiMissingKey } from './kimi-api.js';
import { createAdapter, assertProductionAdapter } from './index.js';

const CONFIG = {
  mode: 'kimi-api' as const,
  apiKey: 'test-key',
  apiBaseUrl: 'https://api.test/v1',
  apiModel: 'kimi-k2-test',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('KimiApiAdapter (fast brain real, §7.2)', () => {
  it('sendTurn chama chat completions com o prompt e parseia resposta + usage', async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return jsonResponse({
        choices: [{ message: { content: 'Olá! Sim, seu site já está no ar. Qualquer coisa me chama.' } }],
        usage: { prompt_tokens: 120, completion_tokens: 18, total_tokens: 138 },
      });
    };
    const a = new KimiApiAdapter(CONFIG, fetchImpl);
    const r = await a.sendTurn({ session_key: 'conv-1', prompt: 'persona + contexto + oi' });

    expect(seen!.url).toBe('https://api.test/v1/chat/completions');
    const body = JSON.parse(String(seen!.init?.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('kimi-k2-test');
    expect(body.messages[0]).toEqual({ role: 'user', content: 'persona + contexto + oi' });
    expect((seen!.init?.headers as Record<string, string>).authorization).toBe('Bearer test-key');

    expect(r.reply_text).toContain('site já está no ar');
    expect(r.session_id).toBe('kimiapi:conv-1');
    expect(r.usage).toEqual({ input_tokens: 120, output_tokens: 18 });
  });

  it('HTTP 401 vira KimiApiError explicado (key inválida — sem fallback)', async () => {
    const a = new KimiApiAdapter(CONFIG, async () => jsonResponse({ error: 'unauthorized' }, 401));
    await expect(a.sendTurn({ session_key: 'k', prompt: 'p' })).rejects.toThrow(KimiApiError);
    await expect(a.sendTurn({ session_key: 'k', prompt: 'p' })).rejects.toThrow(/401/);
  });

  it('resposta sem content falha explicitamente', async () => {
    const a = new KimiApiAdapter(CONFIG, async () => jsonResponse({ choices: [] }));
    await expect(a.sendTurn({ session_key: 'k', prompt: 'p' })).rejects.toThrow(/sem choices/);
  });

  it('key ausente: factory falha na cara — nunca cai pro mock em silêncio', () => {
    delete process.env.KIMI_API_KEY;
    expect(() => createAdapter({ mode: 'kimi-api' })).toThrow(KimiApiMissingKey);
    expect(() => createAdapter({ mode: 'kimi-api' })).toThrow(/KIMI_API_KEY/);
  });

  it('sessão é nominal e stateless (memória vem do context pack)', async () => {
    const a = new KimiApiAdapter(CONFIG, async () => jsonResponse({ choices: [{ message: { content: 'x' } }] }));
    const s1 = await a.ensureSession('conv-9');
    const s2 = await a.ensureSession('conv-9');
    expect(s1.session_id).toBe('kimiapi:conv-9');
    expect(s2.session_id).toBe(s1.session_id);
  });
});

describe('assertProductionAdapter (ADR-016 — anti-mock)', () => {
  it('produção + mock = boot recusado', () => {
    expect(() => assertProductionAdapter('mock', 'production')).toThrow(/ADR-016/);
    expect(() => assertProductionAdapter('kimi-api', 'production')).not.toThrow();
    expect(() => assertProductionAdapter('kimi-web', 'production')).not.toThrow();
  });
  it('fora de produção mock é permitido (dev/testes)', () => {
    expect(() => assertProductionAdapter('mock', 'development')).not.toThrow();
    expect(() => assertProductionAdapter('mock', 'test')).not.toThrow();
  });
});

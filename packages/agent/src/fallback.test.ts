import { describe, it, expect, afterEach } from 'vitest';
import { FallbackAdapter } from './fallback.js';
import type { KimiAdapterConfig } from './types.js';

const CONFIG: KimiAdapterConfig = {
  mode: 'kimi-api',
  apiKey: 'kimi-test-key',
  apiBaseUrl: 'https://kimi.test/v1',
  apiModel: 'kimi-k2-test',
  fallbackApiKey: 'gemini-test-key',
  fallbackBaseUrl: 'https://gemini.test/v1beta/openai/',
  fallbackModel: 'gemini-test',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const okBody = (text: string) => ({
  choices: [{ message: { content: text } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.KIMI_API_KEY_2;
});

describe('FallbackAdapter (ADR-039 — Kimi primária → Gemini na quota)', () => {
  it('Kimi ok → resposta pela primária, provider kimi-api, hook NÃO dispara', async () => {
    const seen: string[] = [];
    let hooked = 0;
    const a = new FallbackAdapter(CONFIG, async (url) => {
      seen.push(url);
      return jsonResponse(okBody('resposta da kimi'));
    }, {
      onFallback: () => hooked++,
    });
    const r = await a.sendTurn({ session_key: 's1', prompt: 'oi' });
    expect(r.reply_text).toBe('resposta da kimi');
    expect(r.provider).toBe('kimi-api');
    expect(hooked).toBe(0);
    expect(seen).toHaveLength(1); // gemini nem foi consultado
  });

  it('403 de quota → UMA tentativa no Gemini → MESMO prompt, provider gemini-api + usage dele', async () => {
    const seen: Array<{ url: string; auth: string; body: string }> = [];
    const hooks: Array<{ from: string; to: string; reason: string }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      seen.push({
        url,
        auth: (init?.headers as Record<string, string>).authorization,
        body: String(init?.body ?? ''),
      });
      if (url.startsWith('https://kimi.test')) {
        return jsonResponse({ error: { message: 'quota exceeded for this month' } }, 403);
      }
      return jsonResponse(okBody('resposta do gemini'));
    };
    const a = new FallbackAdapter(CONFIG, fetchImpl, { onFallback: (i) => hooks.push(i) });
    const r = await a.sendTurn({ session_key: 's2', prompt: 'PROMPT_DO_CLIENTE xyz' });

    expect(seen).toHaveLength(2); // kimi 1x, gemini 1x — nunca mais que uma tentativa de reserva
    expect(seen[0]!.url).toBe('https://kimi.test/v1/chat/completions');
    expect(seen[0]!.auth).toBe('Bearer kimi-test-key');
    expect(seen[1]!.url).toBe('https://gemini.test/v1beta/openai/chat/completions');
    expect(seen[1]!.auth).toBe('Bearer gemini-test-key');
    // MESMO prompt e contexto pro reserva (sem resumo, sem perda de turno)
    expect(seen[1]!.body).toContain('PROMPT_DO_CLIENTE xyz');
    expect(r.reply_text).toBe('resposta do gemini');
    expect(r.provider).toBe('gemini-api');
    expect(r.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
    expect(hooks).toHaveLength(1);
    expect(hooks[0]).toMatchObject({ from: 'kimi-api', to: 'gemini-api' });
    expect(hooks[0]!.reason).toMatch(/403|quota/i);
  });

  it('429 rate-limit também dispara o fallback', async () => {
    const urls: string[] = [];
    const a = new FallbackAdapter(CONFIG, async (url) => {
      urls.push(url);
      return url.startsWith('https://kimi.test')
        ? jsonResponse({ error: 'rate limit' }, 429)
        : jsonResponse(okBody('ok gemini'));
    });
    const r = await a.sendTurn({ session_key: 's3', prompt: 'oi' });
    expect(r.provider).toBe('gemini-api');
    expect(urls).toHaveLength(2);
  });

  it('erro NÃO-quota (500/timeout) SOBE — nunca cai pro Gemini', async () => {
    const urls: string[] = [];
    const a = new FallbackAdapter(CONFIG, async (url) => {
      urls.push(url);
      return jsonResponse({ error: 'internal' }, 500);
    });
    await expect(a.sendTurn({ session_key: 's4', prompt: 'oi' })).rejects.toThrow(/500/);
    expect(urls).toHaveLength(1); // gemini nunca foi chamado
  });

  it('quota da Kimi + falha do Gemini → erro explícito da cadeia com as duas causas', async () => {
    const a = new FallbackAdapter(CONFIG, async (url) =>
      url.startsWith('https://kimi.test')
        ? jsonResponse({ error: 'quota' }, 403)
        : jsonResponse({ error: 'unauthorized' }, 401),
    );
    await expect(a.sendTurn({ session_key: 's5', prompt: 'oi' })).rejects.toThrow(
      /cadeia de quota esgotada/,
    );
  });

  it('quota da Kimi + Gemini com 401 → key inválida marcada: não insiste (fail-closed)', async () => {
    let geminiCalls = 0;
    const a = new FallbackAdapter(CONFIG, async (url) => {
      if (url.startsWith('https://kimi.test')) return jsonResponse({ error: 'quota' }, 403);
      geminiCalls++;
      return jsonResponse({ error: 'invalid key' }, 401);
    });
    await expect(a.sendTurn({ session_key: 's6', prompt: 'oi' })).rejects.toThrow(/401/);
    await expect(a.sendTurn({ session_key: 's6', prompt: 'oi' })).rejects.toThrow(/cadeia de quota esgotada/);
    expect(geminiCalls).toBe(1); // segunda chamada nem tentou o gemini de novo
  });

  it('sem reservas configuradas → erro explícito "cadeia vazia"', async () => {
    delete process.env.GEMINI_API_KEY; // ambiente externo pode ter — o teste exige ausência
    const bare: KimiAdapterConfig = {
      mode: 'kimi-api',
      apiKey: 'kimi-test-key',
      apiBaseUrl: 'https://kimi.test/v1',
      apiModel: 'kimi-k2-test',
    };
    const a = new FallbackAdapter(bare, async () => jsonResponse({ error: 'quota' }, 403));
    await expect(a.sendTurn({ session_key: 's7', prompt: 'oi' })).rejects.toThrow(/cadeia de reserva vazia/);
  });

  describe('cadeia com 2ª key Kimi (decreto owner: 1 kimi → 2 kimi-2 → 3 gemini)', () => {
    it('quota da key 1 → key 2 responde (mesma URL, Bearer da key 2, gemini NÃO chamado)', async () => {
      process.env.KIMI_API_KEY_2 = 'kimi-test-key-2';
      const seen: Array<{ url: string; auth: string }> = [];
      const hooks: Array<{ to: string }> = [];
      const a = new FallbackAdapter(CONFIG, async (url, init) => {
        seen.push({
          url,
          auth: (init?.headers as Record<string, string>).authorization,
        });
        if (seen.length === 1) return jsonResponse({ error: { message: 'quota exceeded' } }, 403);
        return jsonResponse(okBody('resposta da kimi-2'));
      }, { onFallback: (i) => hooks.push({ to: i.to }) });
      const r = await a.sendTurn({ session_key: 'c1', prompt: 'oi' });
      expect(seen).toHaveLength(2); // kimi 1x + kimi-2 1x — gemini nunca
      expect(seen[0]!.auth).toBe('Bearer kimi-test-key');
      expect(seen[1]!.url).toBe('https://kimi.test/v1/chat/completions');
      expect(seen[1]!.auth).toBe('Bearer kimi-test-key-2');
      expect(r.reply_text).toBe('resposta da kimi-2');
      expect(r.provider).toBe('kimi-api');
      expect(hooks).toEqual([{ to: 'kimi-api-2' }]);
    });

    it('key 2 com 401 → marca quebrada e cai pro gemini na MESMA chamada', async () => {
      process.env.KIMI_API_KEY_2 = 'kimi-test-key-2';
      const seen: Array<{ url: string; auth: string }> = [];
      const a = new FallbackAdapter(CONFIG, async (url, init) => {
        seen.push({
          url,
          auth: (init?.headers as Record<string, string>).authorization,
        });
        const auth = seen[seen.length - 1]!.auth;
        if (auth === 'Bearer kimi-test-key') return jsonResponse({ error: 'quota' }, 403);
        if (auth === 'Bearer kimi-test-key-2') return jsonResponse({ error: 'invalid key' }, 401);
        return jsonResponse(okBody('resposta do gemini'));
      });
      const r = await a.sendTurn({ session_key: 'c2', prompt: 'oi' });
      expect(seen).toHaveLength(3); // kimi → kimi-2 (401) → gemini
      expect(seen[2]!.auth).toBe('Bearer gemini-test-key');
      expect(r.provider).toBe('gemini-api');
      // chamada seguinte: kimi-2 NÃO é mais tentado (quebrado)
      const r2 = await a.sendTurn({ session_key: 'c2', prompt: 'oi' });
      expect(seen).toHaveLength(5); // kimi → gemini (pula kimi-2)
      expect(r2.provider).toBe('gemini-api');
    });

    it('key 2 sem env/config → cai direto pro gemini (cadeia vira 2 elos)', async () => {
      const urls: string[] = [];
      const a = new FallbackAdapter(CONFIG, async (url) => {
        urls.push(url);
        return url.startsWith('https://kimi.test')
          ? jsonResponse({ error: 'quota' }, 403)
          : jsonResponse(okBody('ok gemini'));
      });
      const r = await a.sendTurn({ session_key: 'c3', prompt: 'oi' });
      expect(r.provider).toBe('gemini-api');
      expect(urls).toHaveLength(2);
    });
  });

  it('reserva com timeout TRANSITÓRIO repete 1x e pode recuperar (self-test 16:07)', async () => {
    let geminiCalls = 0;
    const a = new FallbackAdapter(CONFIG, async (url) => {
      if (url.startsWith('https://kimi.test')) {
        return jsonResponse({ error: { message: 'quota exceeded' } }, 403);
      }
      geminiCalls++;
      if (geminiCalls === 1) {
        return new Response('upstream timeout', { status: 504 });
      }
      return jsonResponse(okBody('gemini recuperou no retry'));
    });
    const r = await a.sendTurn({ session_key: 's9', prompt: 'oi' });
    expect(r.provider).toBe('gemini-api');
    expect(r.reply_text).toBe('gemini recuperou no retry');
    expect(geminiCalls).toBe(2); // 1 falha transitória + 1 retry
  });

  it('reserva com timeout persistente (2x) falha explícito após o retry', async () => {
    let geminiCalls = 0;
    const a = new FallbackAdapter(CONFIG, async (url) => {
      if (url.startsWith('https://kimi.test')) {
        return jsonResponse({ error: { message: 'quota exceeded' } }, 403);
      }
      geminiCalls++;
      return new Response('upstream timeout', { status: 504 });
    });
    await expect(a.sendTurn({ session_key: 's10', prompt: 'oi' })).rejects.toThrow(/504/);
    expect(geminiCalls).toBe(2); // nunca mais que 1 retry
  });

  it('reserva usa GEMINI_BASE_URL/GEMINI_MODEL do env quando config não traz', async () => {
    process.env.GEMINI_API_KEY = 'gemini-env-key';
    process.env.GEMINI_BASE_URL = 'https://gemini.env.test/openai/';
    process.env.GEMINI_MODEL = 'gemini-env-model';
    const seen: string[] = [];
    const bare: KimiAdapterConfig = {
      mode: 'kimi-api',
      apiKey: 'kimi-test-key',
      apiBaseUrl: 'https://kimi.test/v1',
      apiModel: 'kimi-k2-test',
    };
    const a = new FallbackAdapter(bare, async (url) => {
      seen.push(url);
      return url.startsWith('https://kimi.test')
        ? jsonResponse({ error: 'quota' }, 403)
        : jsonResponse({
            choices: [{ message: { content: 'ok' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          });
    });
    const r = await a.sendTurn({ session_key: 's8', prompt: 'oi' });
    expect(r.provider).toBe('gemini-api');
    expect(seen[1]).toBe('https://gemini.env.test/openai/chat/completions');
    delete process.env.GEMINI_BASE_URL;
    delete process.env.GEMINI_MODEL;
  });
});

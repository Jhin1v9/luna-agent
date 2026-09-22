import { describe, it, expect } from 'vitest';
import { FallbackAdapter } from './fallback.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const CONFIG = {
  mode: 'kimi-api' as const,
  apiKey: 'kimi-key',
  apiBaseUrl: 'https://api.kimi.com/coding/v1',
  apiModel: 'kimi-k2.6',
  fallbackApiKey: 'gemini-key',
  fallbackBaseUrl: 'https://gen.test/openai/',
  fallbackModel: 'gemini-2.5-flash',
};

describe('FallbackAdapter — quota da Kimi cai pro Gemini (nunca mais msg morta)', () => {
  it('Kimi OK → resposta da primária, reserva NÃO chamada, provider kimi-api', async () => {
    const urls: string[] = [];
    const a = new FallbackAdapter(CONFIG, async (url) => {
      urls.push(url);
      if (url.includes('api.kimi.com')) return jsonResponse({ choices: [{ message: { content: 'resposta kimi' } }] });
      return jsonResponse({ choices: [{ message: { content: 'resposta gemini' } }] });
    });
    const r = await a.sendTurn({ session_key: 's', prompt: 'p' });
    expect(r.reply_text).toBe('resposta kimi');
    expect(r.provider).toBe('kimi-api');
    expect(urls.every((u) => u.includes('api.kimi.com'))).toBe(true);
  });

  it('Kimi 403 quota → MESMO prompt pro Gemini, provider gemini-api no resultado', async () => {
    const geminiBodies: string[] = [];
    const a = new FallbackAdapter(CONFIG, async (url, init) => {
      if (url.includes('api.kimi.com')) {
        return jsonResponse({ error: { message: "You've reached your 5-hour quota" } }, 403);
      }
      geminiBodies.push(String(init?.body));
      return jsonResponse({
        choices: [{ message: { content: 'resposta gemini' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    });
    const r = await a.sendTurn({ session_key: 's', prompt: 'persona + contexto + pergunta' });
    expect(r.reply_text).toBe('resposta gemini');
    expect(r.provider).toBe('gemini-api');
    expect(geminiBodies[0]).toContain('persona + contexto + pergunta'); // mesmo prompt/contexto
    expect(r.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it('erro NÃO-quota (timeout/rede) NÃO usa reserva — sobe', async () => {
    const a = new FallbackAdapter(CONFIG, async (url) => {
      if (url.includes('api.kimi.com')) {
        const e = new Error('aborted');
        e.name = 'AbortError';
        throw e;
      }
      return jsonResponse({ choices: [{ message: { content: 'x' } }] });
    });
    await expect(a.sendTurn({ session_key: 's', prompt: 'p' })).rejects.toThrow(/timeout/);
  });

  it('resposta malformada NÃO usa reserva (é bug, não quota)', async () => {
    const a = new FallbackAdapter(CONFIG, async (url) => {
      if (url.includes('api.kimi.com')) return jsonResponse({ choices: [] });
      return jsonResponse({ choices: [{ message: { content: 'x' } }] });
    });
    await expect(a.sendTurn({ session_key: 's', prompt: 'p' })).rejects.toThrow(/sem choices/);
  });

  it('Gemini com key inválida (401) → marca reserva quebrada e falha explícita', async () => {
    let geminiCalls = 0;
    const a = new FallbackAdapter(CONFIG, async (url) => {
      if (url.includes('api.kimi.com')) return jsonResponse({ error: { message: 'quota exceeded' } }, 429);
      geminiCalls++;
      return jsonResponse({ error: { message: 'Invalid Auth key' } }, 401);
    });
    await expect(a.sendTurn({ session_key: 's', prompt: 'p' })).rejects.toThrow(/reserva Gemini com key inválida|fallback Gemini falhou/);
    // segunda chamada: reserva não é mais tentada
    const callsBefore = geminiCalls;
    await expect(a.sendTurn({ session_key: 's', prompt: 'p' })).rejects.toThrow();
    expect(geminiCalls).toBe(callsBefore);
  });

  it('sem GEMINI_API_KEY → falha explícita nomeando o que falta', async () => {
    const a = new FallbackAdapter({ ...CONFIG, fallbackApiKey: '' }, async () => jsonResponse({}, 403));
    delete process.env.GEMINI_API_KEY;
    await expect(a.sendTurn({ session_key: 's', prompt: 'p' })).rejects.toThrow(/GEMINI_API_KEY/);
  });
});

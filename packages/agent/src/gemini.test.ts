import { describe, it, expect } from 'vitest';
import { GeminiAdapter } from './gemini.js';
import { ApiKeyMissing, ChatCompletionsError } from './openai-compat.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GeminiAdapter (fast brain interino, ADR-018)', () => {
  it('sendTurn usa endpoint OpenAI-compatible com key GEMINI_API_KEY', async () => {
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    let seen: { url: string; init?: RequestInit } | null = null;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return jsonResponse({
        choices: [{ message: { content: 'Resposta gerada pelo Gemini de teste.' } }],
        usage: { prompt_tokens: 88, completion_tokens: 12, total_tokens: 100 },
      });
    };
    const a = new GeminiAdapter({ mode: 'gemini', apiBaseUrl: 'https://gen.test/v1beta/openai/' }, fetchImpl);
    const r = await a.sendTurn({ session_key: 'conv-1', prompt: 'persona + contexto + oi' });

    expect(a.mode).toBe('gemini');
    expect(seen!.url).toBe('https://gen.test/v1beta/openai/chat/completions');
    expect((seen!.init?.headers as Record<string, string>).authorization).toBe('Bearer gemini-test-key');
    const body = JSON.parse(String(seen!.init?.body)) as { model: string };
    expect(body.model).toBe('gemini-2.5-flash');
    expect(r.reply_text).toContain('Gemini de teste');
    expect(r.session_id).toBe('gemini-api:conv-1');
    expect(r.usage).toEqual({ input_tokens: 88, output_tokens: 12 });
    delete process.env.GEMINI_API_KEY;
  });

  it('key ausente: falha explícita na cara (nunca fallback pro mock)', () => {
    delete process.env.GEMINI_API_KEY;
    expect(() => new GeminiAdapter({ mode: 'gemini' })).toThrow(ApiKeyMissing);
    expect(() => new GeminiAdapter({ mode: 'gemini' })).toThrow(/GEMINI_API_KEY/);
  });

  it('HTTP 401 vira ChatCompletionsError', async () => {
    const a = new GeminiAdapter(
      { mode: 'gemini', apiKey: 'x' },
      async () => jsonResponse({ error: 'invalid key' }, 401),
    );
    await expect(a.sendTurn({ session_key: 'k', prompt: 'p' })).rejects.toThrow(ChatCompletionsError);
  });
});

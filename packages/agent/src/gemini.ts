import type { KimiAdapterConfig } from './types.js';
import { OpenAiCompatAdapter } from './openai-compat.js';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * GeminiAdapter — fast brain INTERINO para teste (ADR-018, decreto do owner).
 *
 * Mesma interface estável (`ensureSession/sendTurn/readMessages`) e mesmas
 * garantias do kimi-api (sem fallback pro mock, usage → usage_entries). Quando
 * a key da plataforma Kimi existir, o modo oficial volta a ser `kimi-api` e
 * este modo sai de circulação.
 */
export class GeminiAdapter extends OpenAiCompatAdapter {
  constructor(config: KimiAdapterConfig = { mode: 'gemini' }, fetchImpl?: FetchLike) {
    super(
      config,
      {
        mode: 'gemini',
        provider: 'gemini-api',
        keyEnv: 'GEMINI_API_KEY',
        defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        defaultModel: 'gemini-2.5-flash',
      },
      fetchImpl,
    );
  }
}

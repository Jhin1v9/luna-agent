import type { KimiAdapterConfig } from './types.js';
import { OpenAiCompatAdapter, ApiKeyMissing } from './openai-compat.js';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * KimiApiAdapter — Cérebro Rápido oficial (§7.2, ADR-002/016). Ver
 * OpenAiCompatAdapter: endpoint OpenAI-compatible da Moonshot, sem fallback
 * para mock — se a API falha, o turno falha (retry → DLQ).
 */
export class KimiApiAdapter extends OpenAiCompatAdapter {
  constructor(config: KimiAdapterConfig = { mode: 'kimi-api' }, fetchImpl?: FetchLike) {
    super(
      config,
      {
        mode: 'kimi-api',
        provider: 'kimi-api',
        keyEnv: 'KIMI_API_KEY',
        defaultBaseUrl: 'https://api.moonshot.ai/v1',
        defaultModel: 'kimi-k2-0905-preview',
      },
      fetchImpl,
    );
  }
}

export function assertKimiApiKey(config: KimiAdapterConfig): string {
  const key = config.apiKey ?? process.env.KIMI_API_KEY;
  if (!key) throw new ApiKeyMissing('KIMI_API_KEY');
  return key;
}

/** Compat: erro histórico — agora é ChatCompletionsError. */
export { ChatCompletionsError as KimiApiError } from './openai-compat.js';
export { ApiKeyMissing as KimiApiMissingKey } from './openai-compat.js';

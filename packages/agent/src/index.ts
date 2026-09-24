import type { KimiAdapterConfig, KimiLiveAdapter, KimiAdapterMode } from './types.js';
import { MockKimiAdapter } from './mock.js';
import { KimiWebAdapter } from './kimi-web.js';
import { KimiApiAdapter } from './kimi-api.js';
import { KimiCliAdapter } from './kimi-cli.js';
import { GeminiAdapter } from './gemini.js';
import { PiAdapter } from './pi.js';
import { KimiWorkAdapter } from './kimiwork.js';
import { FallbackAdapter } from './fallback.js';

export function createAdapter(config: KimiAdapterConfig): KimiLiveAdapter {
  switch (config.mode) {
    case 'mock':
      return new MockKimiAdapter(config);
    case 'kimi-web':
      return new KimiWebAdapter(config);
    case 'kimi-api':
      // ADR-039: com GEMINI_API_KEY no ambiente, o fast brain nasce com a
      // reserva ligada (quota 403/429 → Gemini, uma tentativa). Sem a key,
      // comportamento histórico: KimiApiAdapter puro (falha explícita).
      return config.fallbackApiKey ?? process.env.GEMINI_API_KEY
        ? new FallbackAdapter(config)
        : new KimiApiAdapter(config);
    case 'kimi-cli':
      return new KimiCliAdapter(config);
    case 'gemini':
      return new GeminiAdapter(config);
    case 'pi':
      return new PiAdapter(config);
    case 'kimiwork':
      // ADR-040 — Kimi Work como cérebro (decreto owner 2026-09-24): turnos
      // na fila kimiwork_llm_turns; a Luna do Kimi Work responde na varredura.
      return new KimiWorkAdapter(config);
  }
}

/**
 * Decreto do owner (ADR-016): resposta de cliente NUNCA vem do mock.
 * Em produção, subir com adapter mock é falha de boot — explícita, nunca
 * silenciosa. 'gemini' é permitido como brain real INTERINO (ADR-018).
 */
export function assertProductionAdapter(mode: KimiAdapterMode, nodeEnv: string): void {
  if (nodeEnv === 'production' && mode === 'mock') {
    throw new Error(
      'Recusado: NODE_ENV=production com KIMI_ADAPTER_MODE=mock. Resposta de ' +
        'cliente nunca sai do mock (ADR-016). Use kimi-api (fast brain oficial), ' +
        'gemini (interino, ADR-018) ou kimi-web (live brain).',
    );
  }
}

export {
  KimiAdapterError,
  KimiWebTurnError,
  KimiWebUnavailable,
} from './types.js';
export type {
  KimiAdapterConfig,
  KimiAdapterMode,
  KimiLiveAdapter,
  SessionInfo,
  TurnRequest,
  TurnResult,
} from './types.js';
export { MockKimiAdapter } from './mock.js';
export { KimiWebAdapter } from './kimi-web.js';
export { KimiApiAdapter, KimiApiError, KimiApiMissingKey, assertKimiApiKey } from './kimi-api.js';
export { KimiCliAdapter } from './kimi-cli.js';
export type { CliSpawn, CliSpawned, KimiCliAdapterDeps } from './kimi-cli.js';
export { GeminiAdapter } from './gemini.js';
export { FallbackAdapter } from './fallback.js';
export type { FallbackHooks } from './fallback.js';
export { PiAdapter } from './pi.js';
export type { PiAdapterDeps } from './pi.js';
export { KimiWorkAdapter } from './kimiwork.js';
export type { KimiWorkAdapterDeps, PoolLike } from './kimiwork.js';
export { probeVisionSupport } from './vision-probe.js';
export type { VisionProbeResult } from './vision-probe.js';
export {
  OpenAiCompatAdapter,
  ApiKeyMissing,
  ChatCompletionsError,
} from './openai-compat.js';

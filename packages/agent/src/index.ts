import type { KimiAdapterConfig, KimiLiveAdapter, KimiAdapterMode } from './types.js';
import { MockKimiAdapter } from './mock.js';
import { KimiWebAdapter } from './kimi-web.js';
import { KimiApiAdapter } from './kimi-api.js';

export function createAdapter(config: KimiAdapterConfig): KimiLiveAdapter {
  switch (config.mode) {
    case 'mock':
      return new MockKimiAdapter(config);
    case 'kimi-web':
      return new KimiWebAdapter(config);
    case 'kimi-api':
      return new KimiApiAdapter(config);
  }
}

/**
 * Decreto do owner (ADR-016): resposta de cliente NUNCA vem do mock.
 * Em produção, subir com adapter mock é falha de boot — explícita, nunca
 * silenciosa.
 */
export function assertProductionAdapter(mode: KimiAdapterMode, nodeEnv: string): void {
  if (nodeEnv === 'production' && mode === 'mock') {
    throw new Error(
      'Recusado: NODE_ENV=production com KIMI_ADAPTER_MODE=mock. Resposta de ' +
        'cliente nunca sai do mock (ADR-016). Use kimi-api (fast brain real) ' +
        'ou kimi-web (live brain).',
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

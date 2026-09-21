import type { KimiAdapterConfig, KimiLiveAdapter } from './types.js';
import { MockKimiAdapter } from './mock.js';
import { KimiWebAdapter } from './kimi-web.js';

export function createAdapter(config: KimiAdapterConfig): KimiLiveAdapter {
  switch (config.mode) {
    case 'mock':
      return new MockKimiAdapter(config);
    case 'kimi-web':
      return new KimiWebAdapter(config);
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

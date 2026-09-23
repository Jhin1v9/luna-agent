import type {
  KimiAdapterConfig,
  KimiLiveAdapter,
  SessionInfo,
  TurnRequest,
  TurnResult,
} from './types.js';
import { KimiApiAdapter } from './kimi-api.js';
import { GeminiAdapter } from './gemini.js';

/**
 * FallbackAdapter — Kimi (primária) → Gemini (reserva) em falha de QUOTA
 * (403/429/rate-limit). Motivo real: a quota da Kimi já matou 5+ eventos de
 * cliente (DLQ) — nunca mais uma mensagem de cliente morre por quota.
 *
 * Regras:
 *  - Só cai pro fallback em erro de QUOTA/rate; timeout/rede/malformada sobem
 *    (são bugs/config, não quota).
 *  - Gemini SÓ é usado se a key for válida — validação lazy na primeira
 *    tentativa; key inválida → marca reserva quebrada, falha explícita auditada.
 *  - usage_entries registra o provider REAL (TurnResult.provider).
 *  - Kimi continua primária em TODA chamada seguinte.
 */

const QUOTA_RE = /403|401|429|quota|rate.?limit|insufficient|exceeded/i;

/** Hook de observabilidade do fallback (log + evento router.provider.unavailable). */
export interface FallbackHooks {
  onFallback?: (info: { from: string; to: string; reason: string }) => void;
}

export class FallbackAdapter implements KimiLiveAdapter {
  readonly mode = 'kimi-api' as const;
  private primary: KimiApiAdapter;
  private fallback: GeminiAdapter | null = null;
  private fallbackBroken = false;

  constructor(
    private readonly config: KimiAdapterConfig,
    private readonly fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>,
    private readonly hooks: FallbackHooks = {},
  ) {
    this.primary = new KimiApiAdapter(config, fetchImpl);
    const geminiKey = config.fallbackApiKey ?? process.env.GEMINI_API_KEY;
    if (geminiKey) {
      // BaseUrl/modelo da reserva vêm de GEMINI_* por padrão — LLM_* aponta
      // para a PRIMÁRIA e não pode vazar para o adapter do Gemini.
      this.fallback = new GeminiAdapter(
        {
          mode: 'gemini',
          apiKey: geminiKey,
          apiBaseUrl: config.fallbackBaseUrl ?? process.env.GEMINI_BASE_URL,
          apiModel: config.fallbackModel ?? process.env.GEMINI_MODEL,
        },
        fetchImpl,
      );
    }
  }

  async ensureSession(sessionKey: string): Promise<SessionInfo> {
    return this.primary.ensureSession(sessionKey);
  }

  async sendTurn(request: TurnRequest): Promise<TurnResult> {
    try {
      const r = await this.primary.sendTurn(request);
      return { ...r, provider: 'kimi-api' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!QUOTA_RE.test(msg)) throw err;
      if (!this.fallback || this.fallbackBroken) {
        throw new Error(
          `quota da Kimi esgotada e reserva Gemini ${this.fallback ? 'com key inválida' : 'sem GEMINI_API_KEY'} — ${msg}`,
        );
      }
      try {
        const r = await this.fallback.sendTurn(request);
        // Sem fallback silencioso: hook vira log explícito +
        // evento router.provider.unavailable no orchestrator.
        this.hooks.onFallback?.({ from: 'kimi-api', to: 'gemini-api', reason: msg });
        return { ...r, provider: 'gemini-api' };
      } catch (err2) {
        const msg2 = err2 instanceof Error ? err2.message : String(err2);
        if (/401|400|403/i.test(msg2)) {
          this.fallbackBroken = true; // key inválida: não insiste
        }
        throw new Error(`fallback Gemini falhou após quota da Kimi: ${msg2} (original: ${msg})`);
      }
    }
  }

  async readMessages(sessionKey: string, afterSeq?: number): Promise<unknown[]> {
    return this.primary.readMessages(sessionKey, afterSeq);
  }
}

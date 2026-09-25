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
 * FallbackAdapter — cadeia de QUOTA (decreto owner 2026-09-24):
 * Kimi key 1 (primária) → Kimi key 2 (KIMI_API_KEY_2) → Gemini (reserva).
 * Motivo real: a quota da Kimi já matou 5+ eventos de cliente (DLQ) — nunca
 * mais uma mensagem de cliente morre por quota.
 *
 * Regras:
 *  - Só cai pro fallback em erro de QUOTA/rate; timeout/rede/malformada sobem
 *    (são bugs/config, não quota).
 *  - Cada reserva SÓ é usada se tiver key válida — validação lazy; key inválida
 *    (401/400/403) marca AQUELE elo quebrado e passa pro próximo.
 *  - usage_entries registra o provider REAL (TurnResult.provider).
 *  - Kimi key 1 continua primária em TODA chamada seguinte.
 */

export const QUOTA_RE = /403|401|429|quota|rate.?limit|insufficient|exceeded/i;
export const TRANSIENT_RE = /timeout|inacessível|rede\/DNS|econnreset|etimedout|socket|HTTP 5\d\d/i;

/** Hook de observabilidade do fallback (log + evento router.provider.unavailable). */
export interface FallbackHooks {
  onFallback?: (info: { from: string; to: string; reason: string }) => void;
}

type Reserva = { nome: string; adapter: KimiApiAdapter | GeminiAdapter };

export class FallbackAdapter implements KimiLiveAdapter {
  readonly mode = 'kimi-api' as const;
  private primary: KimiApiAdapter;
  private reservas: Reserva[] = [];
  private quebradas = new Set<string>();

  constructor(
    private readonly config: KimiAdapterConfig,
    private readonly fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>,
    private readonly hooks: FallbackHooks = {},
  ) {
    this.primary = new KimiApiAdapter(config, fetchImpl);

    // Elo 2: Kimi com a 2ª key (mesmo endpoint/modelo da primária, key extra).
    const kimiKey2 = config.fallbackKimiApiKey ?? process.env.KIMI_API_KEY_2;
    if (kimiKey2) {
      this.reservas.push({
        nome: 'kimi-api-2',
        adapter: new KimiApiAdapter({ ...config, apiKey: kimiKey2 }, fetchImpl),
      });
    }

    // Elo 3: Gemini. BaseUrl/modelo vêm de GEMINI_* por padrão — LLM_* aponta
    // para a PRIMÁRIA e não pode vazar para o adapter do Gemini.
    const geminiKey = config.fallbackApiKey ?? process.env.GEMINI_API_KEY;
    if (geminiKey) {
      this.reservas.push({
        nome: 'gemini-api',
        adapter: new GeminiAdapter(
          {
            mode: 'gemini',
            apiKey: geminiKey,
            apiBaseUrl: config.fallbackBaseUrl ?? process.env.GEMINI_BASE_URL,
            apiModel: config.fallbackModel ?? process.env.GEMINI_MODEL,
          },
          fetchImpl,
        ),
      });
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
      if (this.reservas.length === 0) {
        throw new Error(
          `quota da Kimi esgotada e cadeia de reserva vazia (sem KIMI_API_KEY_2 nem GEMINI_API_KEY) — ${msg}`,
        );
      }
      // Cadeia: tenta cada elo em ordem (kimi-2 → gemini). Por elo:
      //  - UMA tentativa normal; erro TRANSITÓRIO (timeout/rede/5xx) repete 1x.
      //  - 401/400/403: key inválida — marca o elo quebrado e passa pro próximo.
      //  - 429/quota da reserva: não repete o elo, passa pro próximo.
      const erros: string[] = [];
      for (const reserva of this.reservas) {
        if (this.quebradas.has(reserva.nome)) continue;
        let lastErr: unknown;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const r = await reserva.adapter.sendTurn(request);
            // Sem fallback silencioso: hook vira log explícito +
            // evento router.provider.unavailable no orchestrator.
            this.hooks.onFallback?.({ from: 'kimi-api', to: reserva.nome, reason: msg });
            return { ...r, provider: reserva.nome === 'gemini-api' ? 'gemini-api' : 'kimi-api' };
          } catch (err2) {
            lastErr = err2;
            const msg2 = err2 instanceof Error ? err2.message : String(err2);
            if (/401|400|403/i.test(msg2)) {
              this.quebradas.add(reserva.nome); // key inválida: não insiste
              break;
            }
            if (QUOTA_RE.test(msg2)) break; // 429/quota da reserva: próximo elo
            if (!TRANSIENT_RE.test(msg2)) break; // erro de cliente/parse: próximo elo
          }
        }
        erros.push(`${reserva.nome}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
      }
      throw new Error(`cadeia de quota esgotada (kimi → kimi-2 → gemini) — [${erros.join(' | ')}] (original: ${msg})`);
    }
  }

  async readMessages(sessionKey: string, afterSeq?: number): Promise<unknown[]> {
    return this.primary.readMessages(sessionKey, afterSeq);
  }
}

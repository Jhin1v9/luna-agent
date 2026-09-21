import type {
  KimiAdapterConfig,
  KimiLiveAdapter,
  SessionInfo,
  TurnRequest,
  TurnResult,
} from './types.js';
import { KimiAdapterError } from './types.js';

/**
 * KimiApiAdapter — Cérebro Rápido REAL (§7.2, ADR-002/016).
 *
 * REST estável e documentada (chat completions, compatível Moonshot):
 *   POST {KIMI_API_BASE_URL}/chat/completions
 *   { model, messages: [{role:'user', content: prompt}], temperature }
 *
 * Decreto do owner (ADR-016): resposta de cliente NUNCA sai do mock. Este
 * adapter não tem fallback — se a API falha, o turno falha (o handler audita
 * o erro e o evento vai pra retry/DLQ; cair pro mock em silêncio é proibido).
 *
 * Fast brain é stateless: a "sessão persistente" é a memória montada pelo
 * Context Builder a partir do Postgres (pack CLIENT_CONVERSATION). O
 * session_id é nominal — a continuidade vive do histórico em messages.
 */

export class KimiApiMissingKey extends KimiAdapterError {
  constructor() {
    super(
      'KIMI_API_KEY ausente — brain real desligado. Defina a key em .env ' +
        '(nunca commite). Modo mock é só para testes/fallback dev (ADR-016).',
    );
    this.name = 'KimiApiMissingKey';
  }
}

export class KimiApiError extends KimiAdapterError {
  constructor(
    readonly status: number,
    detail: string,
    cause?: unknown,
  ) {
    super(`Kimi API HTTP ${status}: ${detail}`, cause);
    this.name = 'KimiApiError';
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface ChatCompletionsResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export function assertKimiApiKey(config: KimiAdapterConfig): string {
  const key = config.apiKey ?? process.env.KIMI_API_KEY;
  if (!key) throw new KimiApiMissingKey();
  return key;
}

export class KimiApiAdapter implements KimiLiveAdapter {
  readonly mode = 'kimi-api' as const;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(
    config: KimiAdapterConfig,
    fetchImpl?: FetchLike,
  ) {
    this.baseUrl = (config.apiBaseUrl ?? process.env.KIMI_API_BASE_URL ?? 'https://api.moonshot.ai/v1').replace(/\/$/, '');
    this.model = config.apiModel ?? process.env.KIMI_API_MODEL ?? 'kimi-k2-0905-preview';
    this.apiKey = assertKimiApiKey(config);
    this.fetchImpl = fetchImpl ?? fetch;
    this.timeoutMs = config.apiTimeoutMs ?? 60_000;
  }

  async ensureSession(sessionKey: string): Promise<SessionInfo> {
    // Fast brain stateless: a continuidade é o histórico em Postgres.
    return { session_id: `kimiapi:${sessionKey}`, busy: false };
  }

  async sendTurn(request: TurnRequest): Promise<TurnResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: request.prompt }],
          temperature: 0.6,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new KimiAdapterError(`Kimi API timeout após ${this.timeoutMs}ms`, err);
      }
      throw new KimiAdapterError('Kimi API inacessível (rede/ DNS)', err);
    }
    clearTimeout(timer);

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      if (res.status === 401) throw new KimiApiError(401, 'key inválida ou sem crédito', undefined);
      throw new KimiApiError(res.status, detail);
    }

    const data = (await res.json()) as ChatCompletionsResponse;
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new KimiApiError(res.status, 'resposta sem choices[0].message.content');
    }

    return {
      reply_text: content,
      session_id: `kimiapi:${request.session_key}`,
      duration_ms: Date.now() - started,
      usage: data.usage
        ? {
            input_tokens: data.usage.prompt_tokens ?? 0,
            output_tokens: data.usage.completion_tokens ?? 0,
          }
        : undefined,
    };
  }

  async readMessages(_sessionKey: string, _afterSeq?: number): Promise<unknown[]> {
    // §20 run buffer com cursor é responsabilidade da sessão live (kimi-web).
    return [];
  }
}

import type {
  KimiAdapterConfig,
  KimiLiveAdapter,
  SessionInfo,
  TurnRequest,
  TurnResult,
} from './types.js';
import { KimiAdapterError } from './types.js';

/**
 * OpenAiCompatAdapter — base do fast brain via endpoint OpenAI-compatible
 * de chat completions (§7.2). Cobre:
 *   · kimi-api  → api.moonshot.ai (fast brain oficial, ADR-002/016)
 *   · gemini    → generativelanguage.googleapis.com/v1beta/openai/
 *                 (INTERINO p/ teste — ADR-018; Kimi API volta a ser o oficial)
 *
 * Decreto ADR-016 vale para os dois: SEM fallback para mock — key ausente,
 * 401, timeout ou resposta malformada = o turno falha explicitamente.
 */

export class ApiKeyMissing extends KimiAdapterError {
  constructor(envName: string) {
    super(
      `${envName} ausente — brain real desligado. Defina a key em .env (nunca ` +
        `commite). Modo mock é só para testes/fallback dev (ADR-016).`,
    );
    this.name = 'ApiKeyMissing';
  }
}

export class ChatCompletionsError extends KimiAdapterError {
  constructor(
    readonly status: number,
    detail: string,
    cause?: unknown,
  ) {
    super(`chat completions HTTP ${status}: ${detail}`, cause);
    this.name = 'ChatCompletionsError';
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface ChatCompletionsResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export interface OpenAiCompatOptions {
  /** Valor do campo mode do adapter (vai pra audit/agent_runs/usage). */
  mode: 'kimi-api' | 'gemini';
  /** Nome do provedor nas tabelas de uso (usage_entries.provider). */
  provider: string;
  /** Env var da key. */
  keyEnv: string;
  defaultBaseUrl: string;
  defaultModel: string;
}

export class OpenAiCompatAdapter implements KimiLiveAdapter {
  readonly mode: 'kimi-api' | 'gemini';
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly temperature: number | undefined;
  readonly provider: string;

  constructor(
    config: KimiAdapterConfig,
    private readonly opts: OpenAiCompatOptions,
    fetchImpl?: FetchLike,
  ) {
    this.mode = opts.mode;
    this.provider = opts.provider;
    // Contrato §9: LLM_* é a fonte primária (troca de provider = só .env);
    // overrides específicos do modo (GEMINI_*/KIMI_API_*) e defaults por último.
    const key =
      config.apiKey ?? process.env.LLM_API_KEY ?? process.env[opts.keyEnv];
    if (!key) throw new ApiKeyMissing('LLM_API_KEY/' + opts.keyEnv);
    this.apiKey = key;
    const modePrefix = opts.mode === 'gemini' ? 'GEMINI' : 'KIMI_API';
    this.baseUrl = (
      config.apiBaseUrl ??
      process.env.LLM_BASE_URL ??
      process.env[`${modePrefix}_BASE_URL`] ??
      opts.defaultBaseUrl
    ).replace(/\/$/, '');
    this.model =
      config.apiModel ??
      process.env.LLM_MODEL ??
      process.env[`${modePrefix}_MODEL`] ??
      opts.defaultModel;
    this.fetchImpl = fetchImpl ?? fetch;
    this.timeoutMs = config.apiTimeoutMs ?? 60_000;
    this.temperature = config.apiTemperature;
  }

  async ensureSession(sessionKey: string): Promise<SessionInfo> {
    // Fast brain stateless: a continuidade é o histórico montado pelo
    // Context Builder a partir do Postgres.
    return { session_id: `${this.provider}:${sessionKey}`, busy: false };
  }

  async sendTurn(request: TurnRequest): Promise<TurnResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    // Vision (owner 27/09 — "ela não vê imagem"): o k2 é texto puro; com
    // imagem no turno, troca pro modelo vision (env override por modo).
    const visionModel = process.env[`${this.mode === 'gemini' ? 'GEMINI' : 'KIMI_API'}_VISION_MODEL`];
    const model =
      request.image_base64 && visionModel ? visionModel : this.model;

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: request.image_base64
                ? [
                    { type: 'text', text: request.prompt },
                    { type: 'image_url', image_url: { url: `data:image/png;base64,${request.image_base64}` } },
                  ]
                : request.prompt,
            },
          ],
          // Kimi k2.6 (coding endpoint) rejeita temperature ≠ 1
          // ("only 1 is allowed for this model") — default = não enviar.
          ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new KimiAdapterError(`${this.provider}: timeout após ${this.timeoutMs}ms`, err);
      }
      throw new KimiAdapterError(`${this.provider}: inacessível (rede/DNS)`, err);
    }
    clearTimeout(timer);

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new ChatCompletionsError(res.status, detail);
    }

    const data = (await res.json()) as ChatCompletionsResponse;
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new ChatCompletionsError(res.status, 'resposta sem choices[0].message.content');
    }

    return {
      reply_text: content,
      session_id: `${this.provider}:${request.session_key}`,
      duration_ms: Date.now() - started,
      model,
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

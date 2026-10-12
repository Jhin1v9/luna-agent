import type {
  KimiLiveAdapter,
  SessionInfo,
  TurnRequest,
  TurnResult,
} from './types.js';
import { KimiAdapterError } from './types.js';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * FccAdapter — Cérebro Vivo via FCC local (gateway de providers, ADR-041).
 * `LIVE_BRAIN_PROVIDER=fcc` no .env troca o live brain para o FCC em
 * http://127.0.0.1:8082 sem tocar em código (mesma interface estável).
 *
 * Realidade sondada (2026-10, FCC local): a API do gateway é ANTHROPIC-STYLE
 * — POST /v1/messages com header anthropic-version: 2023-06-01; NÃO existe
 * /chat/completions. Sem auth por default: 401 = FCC com auth ligada → falha
 * explícita pedindo pra checar o FCC (ação humana, igual ao pi ADR-039).
 *
 * O FCC é stateless por turno: ensureSession devolve uma sessão fixa e
 * readMessages é vazio (documentado, mesmo contrato do pi/kimi-cli).
 */

export interface FccAdapterDeps {
  /** Base do FCC (default http://127.0.0.1:8082, override via FCC_BASE_URL). */
  baseUrl?: string;
  /** Modelo (default nvidia_nim/moonshotai/kimi-k3, override via FCC_MODEL). */
  model?: string;
  /** Timeout de parede por turno (default 5 min — turnos de investigação). */
  timeoutMs?: number;
  /** Fetch injetável (testes unitários). */
  fetchImpl?: FetchLike;
}

interface FccMessagesResponse {
  choices?: Array<{ message?: { content?: string } }>;
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class FccAdapter implements KimiLiveAdapter {
  readonly mode = 'fcc' as const;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(deps: FccAdapterDeps = {}) {
    this.baseUrl = (deps.baseUrl ?? process.env.FCC_BASE_URL ?? 'http://127.0.0.1:8082').replace(/\/$/, '');
    this.model = deps.model ?? process.env.FCC_MODEL ?? 'nvidia_nim/moonshotai/kimi-k3';
    this.timeoutMs = deps.timeoutMs ?? 300_000;
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  async ensureSession(_sessionKey: string): Promise<SessionInfo> {
    // FCC é stateless por turno: a continuidade é o prompt montado pelo
    // Context Builder (mesma convenção dos adapters one-shot).
    return { session_id: 'fcc', busy: false };
  }

  async sendTurn(request: TurnRequest): Promise<TurnResult> {
    if (request.image_base64) {
      throw new KimiAdapterError('fcc: análise de imagem não suportada (use o fast brain para visão)');
    }
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 4096,
          messages: [{ role: 'user', content: request.prompt }],
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new KimiAdapterError(`fcc: timeout após ${Math.round(this.timeoutMs / 1000)}s no turno (FCC lento/caido?)`, err);
      }
      throw new KimiAdapterError('fcc: inacessível (rede/DNS) — o FCC local está rodando em 127.0.0.1:8082?', err);
    }
    clearTimeout(timer);

    if (res.status === 401) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new KimiAdapterError(
        `fcc: 401 não autorizado — o FCC está com auth ligada? Cheque o gateway local (127.0.0.1:8082). ${detail}`,
      );
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new KimiAdapterError(`fcc: HTTP ${res.status}: ${detail}`);
    }

    const data = (await res.json()) as FccMessagesResponse;
    // Resposta do gateway: choices[0].message.content (shape OpenAI-like
    // empacotado no endpoint /v1/messages). Fallback defensivo pro shape
    // Anthropic puro (content[0].text).
    const reply =
      data.choices?.[0]?.message?.content ??
      data.content?.find((b) => b.type === 'text')?.text;
    if (typeof reply !== 'string' || reply.length === 0) {
      throw new KimiAdapterError('fcc: resposta sem choices[0].message.content');
    }

    return {
      reply_text: reply,
      session_id: 'fcc',
      duration_ms: Date.now() - started,
      model: this.model,
      provider: 'fcc',
      usage: data.usage
        ? {
            input_tokens: data.usage.input_tokens ?? 0,
            output_tokens: data.usage.output_tokens ?? 0,
          }
        : undefined,
    };
  }

  async readMessages(_sessionKey: string, _afterSeq?: number): Promise<unknown[]> {
    return [];
  }
}

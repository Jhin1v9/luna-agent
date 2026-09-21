import type {
  KimiAdapterConfig,
  KimiLiveAdapter,
  SessionInfo,
  TurnRequest,
  TurnResult,
} from './types.js';
import { KimiWebTurnError, KimiWebUnavailable } from './types.js';

/**
 * KimiWebAdapter — fala com o `kimi web` local em 127.0.0.1 (ADR-010/015).
 *
 * Cobertura F1.3 (sondada contra kimi 0.42.0 em 2026-09-21):
 *   · ensureSession  → POST /api/v1/sessions (metadata.cwd obrigatório)
 *   · readMessages   → GET  /api/v1/sessions/:id/messages
 *   · healthCheck    → GET  /api/v1/meta
 *   · sendTurn       → WS /api/v1/ws, protocolo experimental NÃO documentado.
 *                      Lança KimiWebTurnError (interface estável; o modo mock
 *                      cobre dev/testes até o WS ser mapeado).
 *
 * Segurança (§7.3): só 127.0.0.1/localhost é aceito; bearer token via env,
 * nunca logado (pino redige). fetch injetável para testes unitários.
 */

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface MetaResponse {
  code: number;
  data?: { server_version?: string; backend?: string };
}

interface SessionsResponse {
  code: number;
  data?: { items?: Array<{ id: string; busy?: boolean }> };
}

interface SessionCreateResponse {
  code: number;
  data?: { id: string; busy?: boolean };
}

interface MessagesResponse {
  code: number;
  data?: { items?: unknown[] };
}

function assertLoopback(url: string): void {
  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new KimiWebUnavailable(`protocolo não suportado: ${u.protocol}`);
  }
  if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost' && u.hostname !== '[::1]') {
    throw new KimiWebUnavailable(
      `recusado: kimi web só pode ser acessado em loopback (§7.3), hostname='${u.hostname}'`,
    );
  }
}

export class KimiWebAdapter implements KimiLiveAdapter {
  readonly mode = 'kimi-web' as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private sessions = new Map<string, SessionInfo>();

  constructor(
    private readonly config: KimiAdapterConfig,
    fetchImpl?: FetchLike,
  ) {
    this.baseUrl = (config.webUrl ?? 'http://127.0.0.1:58627').replace(/\/$/, '');
    assertLoopback(this.baseUrl);
    this.fetchImpl = fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.config.webToken) h.authorization = `Bearer ${this.config.webToken}`;
    return h;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) },
      });
    } catch (err) {
      throw new KimiWebUnavailable(`falha de conexão em ${path}`, err);
    }
    if (res.status === 401 || res.status === 403) {
      throw new KimiWebUnavailable(`token inválido ou ausente (HTTP ${res.status})`);
    }
    if (!res.ok) {
      throw new KimiWebUnavailable(`HTTP ${res.status} em ${path}`);
    }
    return (await res.json()) as T;
  }

  /** GET /api/v1/meta — saúde do servidor local. */
  async healthCheck(): Promise<{ server_version: string; backend: string }> {
    const meta = await this.request<MetaResponse>('/api/v1/meta');
    return {
      server_version: meta.data?.server_version ?? 'desconhecida',
      backend: meta.data?.backend ?? '?',
    };
  }

  async ensureSession(sessionKey: string): Promise<SessionInfo> {
    const cached = this.sessions.get(sessionKey);
    if (cached) return cached;

    const cwd = this.config.cwd ?? process.cwd();
    const created = await this.request<SessionCreateResponse>('/api/v1/sessions', {
      method: 'POST',
      body: JSON.stringify({ metadata: { cwd } }),
    });
    if (!created.data?.id) throw new KimiWebUnavailable('resposta sem session id ao criar sessão');
    const session: SessionInfo = { session_id: created.data.id, busy: created.data.busy ?? false };
    this.sessions.set(sessionKey, session);
    return session;
  }

  async sendTurn(_request: TurnRequest): Promise<TurnResult> {
    // WS /api/v1/ws é experimental e não documentado (sondado 2026-09-21).
    // A interface fica estável; a implementação chega quando o protocolo for
    // mapeado. Até lá: modo mock (KIMI_ADAPTER_MODE=mock).
    throw new KimiWebTurnError();
  }

  async readMessages(sessionKey: string, _afterSeq?: number): Promise<unknown[]> {
    const session = await this.ensureSession(sessionKey);
    const res = await this.request<MessagesResponse>(
      `/api/v1/sessions/${session.session_id}/messages`,
    );
    return res.data?.items ?? [];
  }
}

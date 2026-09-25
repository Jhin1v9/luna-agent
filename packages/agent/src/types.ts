/**
 * KimiAdapter — interface estável do Cérebro Vivo (§7.3, ADR-010).
 *
 * O adapter isola o resto do sistema da realidade do `kimi web` local:
 *   Internet → Nexo backend → adapter → 127.0.0.1 → kimi web
 * (o servidor NUNCA fica exposto à internet; bind default 127.0.0.1 + bearer token).
 *
 * Realidade sondada em 2026-09-21 (kimi 0.42.0) — ver docs/adr/ADR-015:
 *   · REST estável: GET /api/v1/meta, GET/POST /api/v1/sessions,
 *     GET /api/v1/sessions/:id/messages (leitura).
 *   · Envio de turno é via WebSocket /api/v1/ws com protocolo NÃO documentado
 *     (experimental). Por isso `sendTurn` no modo 'kimi-web' lança
 *     KimiWebTurnError até o protocolo ser mapeado — a interface não muda.
 *   · Modo 'mock' (default dev/test): determinístico, sem rede.
 */

export type KimiAdapterMode =
  | 'mock'
  | 'kimi-web'
  | 'kimi-api'
  | 'kimi-cli'
  | 'kimi-web-local'
  | 'gemini'
  | 'pi'
  | 'kimiwork';

export interface KimiAdapterConfig {
  mode: KimiAdapterMode;
  /** URL base do kimi web local. Default http://127.0.0.1:58627. */
  webUrl?: string;
  /** Bearer token do servidor (sai do log: pino redige). */
  webToken?: string;
  /** Diretório de trabalho das sessões criadas no kimi web. */
  cwd?: string;
  /** Kimi API (fast brain, §7.2): key só via env/KIMI_API_KEY — nunca commite. */
  apiKey?: string;
  apiBaseUrl?: string;
  apiModel?: string;
  apiTimeoutMs?: number;
  apiTemperature?: number;
  /** Fallback (reserva) — Gemini quando a key existir; quota da primária cai pra cá. */
  fallbackApiKey?: string;
  fallbackBaseUrl?: string;
  fallbackModel?: string;
  /** 2ª key da MESMA API primária (elo 2 da cadeia de quota, antes do Gemini). */
  fallbackKimiApiKey?: string;
  /** Kimi Web LOCAL (ADR-038): sessão dedicada do live brain. */
  KIMIWEB_LOCAL_URL?: string;
  KIMIWEB_LOCAL_TOKEN?: string;
  KIMIWEB_SESSION_ID?: string;
}

/** Um turno de conversa: prompt montado (persona + contexto) + mensagem do cliente. */
export interface TurnRequest {
  /** Chave estável da sessão (ex.: conversation_id) — sessão persistente por conversa. */
  session_key: string;
  /** Prompt completo: persona + context pack + mensagem (prompt+contexto+personalidade). */
  prompt: string;
  /** Imagem (PNG/JPEG base64) para análise visual — auto-reparo §14. Opcional. */
  image_base64?: string;
}

export interface TurnResult {
  reply_text: string;
  session_id: string;
  duration_ms: number;
  /** Uso de tokens quando o backend informa (Kimi API). Vira usage_entries (§23). */
  usage?: { input_tokens: number; output_tokens: number };
  /** Modelo real que respondeu (usage_entries.provider — §9 do contrato). */
  model?: string;
  /** Provider real que respondeu quando há fallback (kimi-api | gemini-api). */
  provider?: string;
}

export interface SessionInfo {
  session_id: string;
  busy: boolean;
}

/** Erro de negócio do adapter — mensagens limpas, sem stack em produção. */
export class KimiAdapterError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'KimiAdapterError';
  }
}

/** Modo kimi-web sem sendTurn disponível (protocolo WS experimental). */
export class KimiWebTurnError extends KimiAdapterError {
  constructor(detail?: string) {
    super(
      `kimi web: envio de turno ainda não suportado via REST (protocolo WS experimental, ` +
        `ver ADR-015). Use KIMI_ADAPTER_MODE=mock ou mapeie o WS.${detail ? ' Detalhe: ' + detail : ''}`,
    );
    this.name = 'KimiWebTurnError';
  }
}

/** Falha de comunicação com o servidor local (fora, token inválido, etc.). */
export class KimiWebUnavailable extends KimiAdapterError {
  constructor(detail: string, cause?: unknown) {
    super(`kimi web indisponível em 127.0.0.1: ${detail}`, cause);
    this.name = 'KimiWebUnavailable';
  }
}

/**
 * Interface estável. Implementações: MockKimiAdapter, KimiWebAdapter.
 * O resto do sistema (orchestrator, worker) programa contra ISTO, nunca
 * contra endpoints concretos.
 */
export interface KimiLiveAdapter {
  readonly mode: KimiAdapterMode;
  /** Garante que existe uma sessão para a chave. Retorna a sessão ativa. */
  ensureSession(sessionKey: string): Promise<SessionInfo>;
  /** Envia um turno e devolve a resposta de texto. */
  sendTurn(request: TurnRequest): Promise<TurnResult>;
  /** Leitura de mensagens da sessão (cursor para §20 run buffer no futuro). */
  readMessages(sessionKey: string, afterSeq?: number): Promise<unknown[]>;
}

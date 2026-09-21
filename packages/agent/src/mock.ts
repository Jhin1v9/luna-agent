import { randomUUID } from 'node:crypto';
import type {
  KimiAdapterConfig,
  KimiLiveAdapter,
  SessionInfo,
  TurnRequest,
  TurnResult,
} from './types.js';

/**
 * MockKimiAdapter — cérebro vivo determinístico para dev/testes (ADR-015).
 *
 * SEM rede, SEM tokens, SEM não-determinismo: a MESMA requisição sempre
 * produz a MESMA resposta — isso é o que permite testes estáveis.
 *
 * A resposta é propositalmente um espelho estruturado da entrada (nunca uma
 * mensagem de cliente de verdade): quem lê o log entende imediatamente que
 * é stub. Templates de mensagem de produção NÃO moram aqui — mensagens reais
 * nascem de prompt+contexto+personalidade (`.kimi-code/agents/luna.md`).
 */
export class MockKimiAdapter implements KimiLiveAdapter {
  readonly mode = 'mock' as const;
  private sessions = new Map<string, SessionInfo>();

  constructor(private readonly config: KimiAdapterConfig = { mode: 'mock' }) {}

  async ensureSession(sessionKey: string): Promise<SessionInfo> {
    let session = this.sessions.get(sessionKey);
    if (!session) {
      session = { session_id: `mock_${randomUUID()}`, busy: false };
      this.sessions.set(sessionKey, session);
    }
    return session;
  }

  async sendTurn(request: TurnRequest): Promise<TurnResult> {
    const started = Date.now();
    const session = await this.ensureSession(request.session_key);
    const promptLines = request.prompt.split('\n').length;
    const reply =
      `[mock-luna] turno recebido na sessão ${session.session_id.slice(0, 12)}… ` +
      `prompt de ${promptLines} linhas processado. ` +
      `Persona + contexto + mensagem chegaram; adapter mock não gera texto de cliente.`;
    return { reply_text: reply, session_id: session.session_id, duration_ms: Date.now() - started };
  }

  async readMessages(_sessionKey: string, _afterSeq?: number): Promise<unknown[]> {
    return [];
  }
}

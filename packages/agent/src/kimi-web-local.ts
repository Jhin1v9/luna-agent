import type { KimiLiveAdapter, SessionInfo, TurnRequest, TurnResult } from './types.js';

/**
 * KimiWebLocalAdapter — Live Brain sobre o `kimi web` LOCAL (ADR-038, decreto
 * owner 2026-09-25): sessão DEDICADA e persistente (KIMIWEB_SESSION_ID) no
 * servidor local (127.0.0.1), com token próprio. O turno vai via
 * POST /api/v1/sessions/{id}/prompts (endpoint verificado ao vivo) e a
 * resposta é lida por poll em /messages até a mensagem do assistente chegar.
 *
 * Por que não o kimi-cli -p: o modo -p subia sem as ferramentas de escrita
 * (o live brain respondia "só tenho tools de leitura"). No servidor web a
 * sessão roda com as ferramentas completas (a mesma sessão edita código).
 * E a sessão é fixa: personalidade + APIs entram UMA vez no bootstrap e todos
 * os turnos continuam nela (sem re-explicar contexto).
 */

export interface KimiWebLocalDeps {
  baseUrl: string; // http://127.0.0.1:58629
  token: string;
  sessionId: string;
  timeoutMs?: number; // parede por turno
  pollMs?: number;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}

interface WebMessage {
  id: string;
  role: string;
  created_at?: string;
  content?: Array<{ type: string; text?: string }>;
}

export class KimiWebLocalAdapter implements KimiLiveAdapter {
  readonly mode = 'kimi-web-local' as unknown as KimiLiveAdapter['mode'];
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  private readonly fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;

  constructor(private readonly deps: KimiWebLocalDeps) {
    this.timeoutMs = deps.timeoutMs ?? 600_000;
    this.pollMs = deps.pollMs ?? 2_500;
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  private hdrs(): Record<string, string> {
    return { authorization: `Bearer ${this.deps.token}`, 'content-type': 'application/json' };
  }

  async ensureSession(_sessionKey: string): Promise<SessionInfo> {
    const r = await this.fetchImpl(`${this.deps.baseUrl}/api/v1/sessions/${this.deps.sessionId}`, { headers: this.hdrs() });
    if (!r.ok) throw new Error(`kimi-web-local: sessão ${this.deps.sessionId} não respondeu (HTTP ${r.status}) — servidor local no ar?`);
    return { session_id: this.deps.sessionId, duration_ms: 0 } as unknown as SessionInfo;
  }

  async sendTurn(request: TurnRequest): Promise<TurnResult> {
    const t0 = Date.now();
    const post = await this.fetchImpl(`${this.deps.baseUrl}/api/v1/sessions/${this.deps.sessionId}/prompts`, {
      method: 'POST',
      headers: this.hdrs(),
      body: JSON.stringify({ content: [{ type: 'text', text: request.prompt }] }),
    });
    if (!post.ok) {
      const body = await post.text().catch(() => '');
      throw new Error(`kimi-web-local: POST prompts → HTTP ${post.status} ${body.slice(0, 200)}`);
    }
    const posted = (await post.json().catch(() => null)) as { data?: { user_message_id?: string } } | null;
    const userMsgId = posted?.data?.user_message_id ?? null;
    const promptHead = request.prompt.slice(0, 80);

    // Poll de messages até a resposta do assistente posterior ao user message.
    // ATENÇÃO à ordenação: a API devolve a página NEWEST-FIRST (verificado
    // ao vivo 2026-09-26). A resposta do turno está ANTES (índice menor) da
    // pergunta — não depois. Versões anteriores liam `slice(startIdx+1)`
    // (só mensagens mais velhas) e devolviam a resposta MAIS ANTIGA da
    // sessão com texto ("Limpando os temporários..." em vez do ping real).
    while (Date.now() - t0 < this.timeoutMs) {
      await new Promise((r) => setTimeout(r, this.pollMs));
      const list = await this.fetchImpl(`${this.deps.baseUrl}/api/v1/sessions/${this.deps.sessionId}/messages`, { headers: this.hdrs() });
      if (!list.ok) continue;
      const data = (await list.json().catch(() => null)) as { data?: WebMessage[] } | null;
      const payload = (data as never as { data?: WebMessage[] | { items?: WebMessage[] } })?.data;
      const msgs = Array.isArray(payload) ? payload : (payload?.items ?? []);
      // localiza o nosso user message (pelo id do POST; fallback: pelo texto)
      let startIdx = userMsgId ? msgs.findIndex((m) => m.id === userMsgId) : -1;
      if (startIdx < 0) {
        startIdx = msgs.findIndex(
          (m) => m.role === 'user' && (m.content ?? []).some((c) => (c.text ?? '').includes(promptHead)),
        );
      }
      // respostas = mensagens MAIS NOVAS que a pergunta (newest-first: índices menores).
      // Só aceita se o prompt foi localizado — senão pode pegar resposta velha.
      if (startIdx > 0) {
        const candidates = msgs.slice(0, startIdx);
        const assistant = candidates.find((m) => m.role === 'assistant');
        if (assistant) {
          const text = (assistant.content ?? []).map((c) => c.text ?? '').join('\n').trim();
          if (text) {
            return { reply_text: text, provider: 'kimi-web-local', session_id: this.deps.sessionId, duration_ms: Date.now() - t0, usage: { input_tokens: 0, output_tokens: 0 } };
          }
        }
      }
      // sessão livre de novo = turno encerrado; se não achou texto, falhou
      const session = await this.fetchImpl(`${this.deps.baseUrl}/api/v1/sessions/${this.deps.sessionId}`, { headers: this.hdrs() }).then((r2) => r2.json().catch(() => null)) as { data?: { busy?: boolean } } | null;
      if (session?.data && session.data.busy === false) {
        throw new Error('kimi-web-local: sessão processou o turno mas não devolveu texto de assistente (resposta vazia)');
      }
    }
    throw new Error(`kimi-web-local: timeout de parede (${Math.round(this.timeoutMs / 1000)}s) aguardando resposta da sessão`);
  }

  async readMessages(_sessionKey: string, _afterSeq?: number): Promise<unknown[]> {
    const list = await this.fetchImpl(`${this.deps.baseUrl}/api/v1/sessions/${this.deps.sessionId}/messages`, { headers: this.hdrs() });
    if (!list.ok) return [];
    const data = (await list.json().catch(() => null)) as { data?: WebMessage[] | { items?: WebMessage[] } } | null;
    const payload = data?.data;
    return (Array.isArray(payload) ? payload : (payload?.items ?? [])) as unknown[];
  }
}

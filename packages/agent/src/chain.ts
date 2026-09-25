import type { KimiAdapterMode, KimiLiveAdapter, SessionInfo, TurnRequest, TurnResult } from './types.js';
import { QUOTA_RE, TRANSIENT_RE } from './fallback.js';

/**
 * ChainAdapter — cadeia ORDENADA de adapters (P3, decreto owner 2026-09-24):
 * quando o modo ativo é kimiwork, o classify deve sobreviver a um kimiwork
 * fora/lento caindo pra cadeia API (kimi → kimi-2 → gemini), e vice-versa.
 * Sem isso, "classify morre quando Kimi dá 403 e Gemini dá 429".
 *
 * Semântica por elo (igual ao FallbackAdapter):
 *  - erro NÃO-quota/transient → sobe (é bug/config, não indisponibilidade).
 *  - quota/rate → próximo elo; auth inválida (401/400/403) marca elo quebrado.
 *  - transitório (timeout/rede/5xx) repete 1x no mesmo elo.
 *  - usage_entries registra o provider REAL (TurnResult.provider do elo).
 */

export interface ChainElo {
  nome: string;
  adapter: KimiLiveAdapter;
}

export interface ChainHooks {
  onElo?: (info: { from: string; to: string; reason: string }) => void;
}

export class ChainAdapter implements KimiLiveAdapter {
  // mode é livre (descritivo da cadeia) — o tipo do adapter composto não é um
  // KimiAdapterMode simples; cast pontual na interface.
  readonly mode = 'chain' as unknown as KimiAdapterMode;
  /** Descrição legível da cadeia (logs/métricas). */
  readonly descricao: string;
  private quebrados = new Set<string>();

  constructor(
    private readonly elos: ChainElo[],
    private readonly hooks: ChainHooks = {},
  ) {
    this.descricao = `chain:${elos.map((e) => e.nome).join('+') || 'vazio'}`;
    if (elos.length === 0) throw new Error('ChainAdapter sem elos');
  }

  async ensureSession(sessionKey: string): Promise<SessionInfo> {
    return this.elos[0]!.adapter.ensureSession(sessionKey);
  }

  async sendTurn(request: TurnRequest): Promise<TurnResult> {
    const erros: string[] = [];
    for (const elo of this.elos) {
      if (this.quebrados.has(elo.nome)) continue;
      let lastErr: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await elo.adapter.sendTurn(request);
          if (erros.length > 0) this.hooks.onElo?.({ from: this.elos[0]!.nome, to: elo.nome, reason: erros.join(' | ') });
          return { ...r, provider: r.provider ?? elo.nome };
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          if (/401|400|403/i.test(msg)) {
            this.quebrados.add(elo.nome); // auth inválida: não insiste nunca mais
            break;
          }
          if (QUOTA_RE.test(msg)) break; // quota do elo: próximo
          if (!TRANSIENT_RE.test(msg)) break; // não-transitório: sobe?? não — próximo elo (cadeia é de disponibilidade)
        }
      }
      erros.push(`${elo.nome}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
    }
    throw new Error(`cadeia esgotada (${this.elos.map((e) => e.nome).join(' → ')}) — [${erros.join(' | ')}]`);
  }

  async readMessages(sessionKey: string, afterSeq?: number): Promise<unknown[]> {
    return this.elos[0]!.adapter.readMessages(sessionKey, afterSeq);
  }
}

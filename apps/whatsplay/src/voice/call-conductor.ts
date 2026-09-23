import type { Logger } from 'pino';
import type { KimiLiveAdapter } from '@luna/agent';
import type { OperatorSession } from './operator-session.js';
import { HOLD_TEXT } from './bridge.js';
import type { Page } from 'playwright-core';

/**
 * CALL CONDUCTOR (ADR-037) — Kimi Live como MAESTRA da chamada.
 *
 * Durante a chamada, um loop lê as transcrições do chat do ChatGPT CONFORME
 * SAEM (cursor) e manda pra Kimi Live com o contexto completo (participantes,
 * objetivo, histórico). A Kimi decide por turno:
 *   (a) SAY  → escreve no chat do ChatGPT o que o Operador deve falar (o
 *       Operador fala na hora — a VOZ nunca decide nada);
 *   (b) ACT  → ação real com evidência (via executeAction injetado — ex.:
 *       enfileirar msg WhatsApp pro cliente);
 *   (c) HOLD → nada a fazer (marca de espera padrão se o dono da vez sumir).
 *
 * Robustez (decreto): loop travando ou Kimi caindo NÃO derruba a chamada —
 * o Operador segue com o que tem, a falha é explícita em log + alerta.
 *
 * LIMITAÇÃO CONHECIDA (2ª chamada ao vivo, 2026-09-23): o cursor lê o thread
 * de TEXTO `[data-message-author-role]`, mas no ChatGPT VOICE mode a fala do
 * interlocutor NÃO vira mensagem no thread — a transcrição vive na UI de voz
 * (legenda/caption ao vivo), outro DOM. Na 2ª chamada a conductora leu o
 * thread de texto (que só tinha o pré-voo) e re-respondeu o planejamento —
 * o Pai OUVIU o plano, mas a conductora não ouviu o Pai. PRÓXIMO PASSO:
 * probe do DOM do voice mode durante chamada ativa (aria-live/captions) e
 * trocar a fonte do readNewTurns.
 */

export interface ConductorTurn {
  speaker: string;
  text: string;
}

export interface ConductorDeps {
  operator: OperatorSession;
  live: KimiLiveAdapter;
  log?: Logger;
  /** Execução de ações reais (ex.: enfileirar msg no WhatsApp). */
  executeAction?: (name: string, detail: string) => Promise<string>;
  pool?: { query: (sql: string, params?: unknown[]) => Promise<unknown> };
  /** Latência-alvo por turno (poll do chat, default 3s). */
  pollMs?: number;
  correlationId?: string;
}

export interface CallBriefConductor {
  participantes: string[];
  objetivo: string;
  /** O que a Kimi pode fazer. */
  poderes: string[];
  tom: string;
}

type Decision =
  | { kind: 'say'; text: string }
  | { kind: 'act'; name: string; detail: string }
  | { kind: 'hold' };

const DECIDE_PROMPT = (brief: CallBriefConductor, history: string, turno: ConductorTurn): string =>
  [
    'Você é a KIMI, conductora desta chamada de voz (sistema a trés: WhatsApp ⇄ Luna ⇄ ChatGPT-voz).',
    'O ChatGPT é SÓ A VOZ — nunca decide nada, fala exatamente o que você escrever no chat dele.',
    `Participantes: ${brief.participantes.join(', ')}.`,
    `Objetivo da chamada: ${brief.objetivo}.`,
    `O que você pode fazer: ${brief.poderes.join('; ')}.`,
    `Tom: ${brief.tom}.`,
    '',
    history ? `Histórico recente:\n${history}` : '',
    `Novo turno (quem falou: ${turno.speaker}): "${turno.text}"`,
    '',
    'Responda APENAS um JSON: {"action":"say","text":"o que o Operador deve falar"} ou',
    '{"action":"act","name":"nome_da_acao","detail":"detalhe"} ou {"action":"hold"}.',
    'say: curto, natural, PT-BR, na personalidade da Luna — o Operador fala NA HORA.',
    'act: só quando uma ação real é pedida/necessária.',
    'hold: quando não há o que responder.',
  ].filter(Boolean)
    .join('\n\n');

export function parseDecision(raw: string): Decision {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { kind: 'say', text: raw.trim().slice(0, 300) };
  try {
    const obj = JSON.parse(m[0]) as { action?: string; text?: string; name?: string; detail?: string };
    if (obj.action === 'say' && obj.text) return { kind: 'say', text: obj.text };
    if (obj.action === 'act' && obj.name) return { kind: 'act', name: obj.name, detail: obj.detail ?? '' };
    return { kind: 'hold' };
  } catch {
    return { kind: 'say', text: raw.trim().slice(0, 300) };
  }
}

export class CallConductor {
  private running = false;
  private failures = 0;
  private readonly history: string[] = [];
  private cursor = 0;

  constructor(private readonly deps: ConductorDeps) {}

  private say(msg: string, extra?: object): void {
    this.deps.log?.info(extra ?? {}, `conductor: ${msg}`);
  }

  private async audit(action: string, metadata: Record<string, unknown>): Promise<void> {
    if (!this.deps.pool) return;
    await this.deps.pool
      .query(
        `INSERT INTO audit_log (actor, action, tool, correlation_id, result, metadata)
         VALUES ('call_conductor', $1, 'call_conductor_loop', $2, $3, $4)`,
        [action, this.deps.correlationId ?? null, metadata.ok === false ? 'failed' : 'success', JSON.stringify(metadata)],
      )
      .catch(() => {});
  }

  /** Lê turnos novos do chat do ChatGPT (cursor). */
  private async readNewTurns(tab: Page): Promise<ConductorTurn[]> {
    const turns = (await tab
      .evaluate(`(() => {
        const out = [];
        document.querySelectorAll('[data-message-author-role]').forEach((el) => {
          out.push({ role: el.getAttribute('data-message-author-role'), text: (el.textContent || '').replace(/\\s+/g, ' ').trim() });
        });
        return out;
      })()`)
      .catch(() => [])) as Array<{ role: string; text: string }>;
    const fresh = turns.slice(this.cursor).filter((t) => t.text.length > 0 && t.role === 'user');
    this.cursor = turns.length;
    return fresh.map((t) => ({ speaker: 'participante', text: t.text }));
  }

  /** Liga o loop da conductora. Retorna handle com stop(). */
  start(tab: Page, brief: CallBriefConductor): { stop: () => void } {
    this.running = true;
    const pollMs = this.deps.pollMs ?? 3_000;
    const loop = async (): Promise<void> => {
      while (this.running) {
        try {
          const fresh = await this.readNewTurns(tab);
          for (const turno of fresh) {
            this.history.push(`- ${turno.speaker}: ${turno.text}`.slice(0, 200));
            if (this.history.length > 12) this.history.shift();
            const decision = await this.deps.live.sendTurn({
              session_key: `conductor:${this.deps.correlationId ?? 'call'}`,
              prompt: DECIDE_PROMPT(brief, this.history.join('\n'), turno),
            }).then((t) => parseDecision(t.reply_text)).catch((err) => {
              this.failures++;
              this.say(`Kimi Live falhou no turno (${String(err).slice(0, 120)}) — Operador segue com o que tem`, { failures: this.failures });
              return { kind: 'hold' } as Decision;
            });
            if (decision.kind === 'say') {
              this.say(`digita pro Operador: "${decision.text.slice(0, 100)}"`);
              await this.deps.operator.sendText(tab, decision.text);
              await this.audit('conductor.say', { text: decision.text.slice(0, 150), turno: turno.text.slice(0, 100) });
            } else if (decision.kind === 'act') {
              this.say(`ação: ${decision.name} — ${decision.detail.slice(0, 100)}`);
              let evidence = 'sem executor';
              if (this.deps.executeAction) {
                evidence = await this.deps.executeAction(decision.name, decision.detail).catch((e) => `falhou: ${String(e).slice(0, 100)}`);
              }
              await this.audit('conductor.act', { name: decision.name, evidence });
              // ação também vira fala quando couber
              if (evidence && evidence !== 'sem executor') {
                await this.deps.operator.sendText(tab, evidence).catch(() => {});
              }
            } else {
              this.say('segura (hold)');
              if (this.failures > 0) await this.deps.operator.sendText(tab, HOLD_TEXT).catch(() => {});
            }
          }
        } catch (err) {
          this.say(`loop falhou (${String(err).slice(0, 150)}) — a chamada NÃO cai; retomando em ${pollMs * 2}ms`);
          await new Promise((r) => setTimeout(r, pollMs * 2));
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }
    };
    void loop();
    return { stop: () => { this.running = false; } };
  }
}

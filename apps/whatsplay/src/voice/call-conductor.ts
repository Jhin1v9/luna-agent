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
  /** 🆕 (decreto owner 2026-09-24) Leitura das CAPTIONS do voice mode
   *  (aria-live) — no modo voz a fala NÃO vira mensagem no thread de texto;
   *  sem isso a conductora é surda durante a chamada real. Dedupe por
   *  conteúdo (as captions evoluem incrementalmente). */
  readVoiceTurns?: (tab: Page) => Promise<ConductorTurn[]>;
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

const DECIDE_PROMPT = (brief: CallBriefConductor, history: string, turnos: ConductorTurn[]): string =>
  [
    'Você é a KIMI, conductora desta chamada de voz (sistema a trés: WhatsApp ⇄ Luna ⇄ ChatGPT-voz).',
    'O ChatGPT é SÓ A VOZ — nunca decide nada, fala exatamente o que você escrever no chat dele.',
    `Participantes: ${brief.participantes.join(', ')}.`,
    `Objetivo da chamada: ${brief.objetivo}.`,
    `O que você pode fazer: ${brief.poderes.join('; ')}.`,
    `Tom: ${brief.tom}.`,
    '',
    history ? `Histórico recente:\n${history}` : '',
    // BATCH (decreto owner 14:28 "ao vivo"): turnos que chegaram enquanto a
    // resposta anterior era processada viajam NUM SÓ pedido — cada roundtrip
    // com a Luna custa segundos; serializar falas rapidas empilhava latência.
    turnos.length === 1
      ? `Novo turno (quem falou: ${turnos[0]!.speaker}): "${turnos[0]!.text}"`
      : `Novos turnos (ordem cronológica — responda ao ESTADO ATUAL da conversa):\n${turnos
          .map((t, i) => `${i + 1}. ${t.speaker}: "${t.text}"`)
          .join('\n')}`,
    '',
    'Responda APENAS um JSON: {"action":"say","text":"o que o Operador deve falar"} ou',
    '{"action":"act","name":"nome_da_acao","detail":"detalhe"} ou {"action":"hold"}.',
    'say: o "text" é uma INSTRUÇÃO PRO OPERADOR — nunca uma mensagem direta pro Abner.',
    'Formato SEMPRE: "Fale para o Abner que ..." / "Pergunte ao Abner se ..." / "Diga que ...".',
    'PROIBIDO escrever como se o Abner fosse ler o chat ("Oi Abner, ...") — o chat é um',
    'barramento INTERNO (Abner→ChatGPT→você→ChatGPT→Abner); a ÚNICA voz do Abner é o Operador.',
    'Curto, natural, PT-BR, na personalidade da Luna — o Operador fala NA HORA.',
    'act: SÓ quando a fala mais recente do owner contém uma ORDEM DIRETA e explícita pra você',
    '(manda/liga/faz/escreve/envia/pode/quero que). Na dúvida: NUNCA aja — responda com',
    '{"action":"say","text":"quer que eu <ação>?"} perguntando antes, ou {"action":"hold"}.',
    'hold: quando não há o que responder.',
    'ECO: mensagens iniciadas com "📟 Luna → Operador:" são SUAS instruções anteriores',
    'voltando no thread — NUNCA as trate como fala do Abner nem do Operador; ignore-as.',
  ].filter(Boolean)
    .join('\n\n');

/**
 * GUARDA DE ORDEM EXPLÍCITA (decreto owner: "nd de mandar mensagem sem
 * permissão, no adivinar, no intentar hacer algo sola"): `act` só vale se o
 * turno atual contém uma ordem direta (e a guarda DEVOLVE a ordem citada pro
 * audit). Sem ordem → vira pergunta ao owner via Operador ("quer que eu X?").
 */
const ORDER_RE =
  /\b(manda|mandar|liga|ligar|faz|fazer|escreve|escrever|envia|enviar|envie|posta|postar|executa|executar|cria|criar|deleta|apaga|atualiza|corre|roda|roda|responde|peça|pede|quero que|pode fazer|me ajuda)\b/i;

export function guardAction(
  decision: Decision,
  turno: ConductorTurn,
): { decision: Decision; ordemCitada?: string } {
  if (decision.kind !== 'act') return { decision };
  const ordem = turno.text.match(ORDER_RE);
  if (ordem) return { decision, ordemCitada: ordem[0] };
  // sem ordem direta no turno: vira pergunta (nunca ação)
  return {
    decision: {
      kind: 'say',
      text: `Quer que eu ${decision.name.replace(/_/g, ' ')} agora? Só faço se você mandar.`,
    },
  };
}

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
  private voiceSeen = new Set<string>();

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
    // PROTEÇÃO DE ECO (fix arquitetura 2026-09-25): mensagens do barramento
    // interno (📟 Luna → Operador:) são relays PRÓPRIOS da conductora voltando
    // no thread — nunca contam como fala de participante.
    const fresh = turns
      .slice(this.cursor)
      .filter((t) => t.text.length > 0 && t.role === 'user' && !t.text.startsWith('📟 Luna → Operador:'));
    this.cursor = turns.length;
    return fresh.map((t) => ({ speaker: 'participante', text: t.text }));
  }

  /** Lê captions novas do voice mode (dedupe por conteúdo — evoluem por
   *  acréscimo, então cada snapshot parcial novo conta como turno; a guarda
   *  do LLM filtra ruído). */
  private async readVoiceNew(tab: Page): Promise<ConductorTurn[]> {
    if (!this.deps.readVoiceTurns) return [];
    const voice = await this.deps.readVoiceTurns(tab).catch(() => [] as ConductorTurn[]);
    const fresh: ConductorTurn[] = [];
    for (const t of voice) {
      const key = t.text.slice(0, 160);
      if (this.voiceSeen.has(key)) continue;
      this.voiceSeen.add(key);
      if (t.text.trim().length >= 4) fresh.push(t);
    }
    // guarda de memória: captions de chamada longa
    if (this.voiceSeen.size > 400) this.voiceSeen = new Set([...this.voiceSeen].slice(-200));
    return fresh;
  }

  /** Liga o loop da conductora. Retorna handle com stop(). */
  start(tab: Page, brief: CallBriefConductor): { stop: () => void } {
    this.running = true;
    const pollMs = this.deps.pollMs ?? 3_000;
    const loop = async (): Promise<void> => {
      while (this.running) {
        try {
          const fresh = [...(await this.readVoiceNew(tab)), ...(await this.readNewTurns(tab))].slice(0, 6);
          if (fresh.length > 0) {
            for (const turno of fresh) {
              this.history.push(`- ${turno.speaker}: ${turno.text}`.slice(0, 200));
              if (this.history.length > 12) this.history.shift();
            }
            // Guarda de ordem explícita olha a fala MAIS RECENTE do lote.
            const ultimo = fresh[fresh.length - 1]!;
            const decision = await this.deps.live.sendTurn({
              session_key: `conductor:${this.deps.correlationId ?? 'call'}`,
              prompt: DECIDE_PROMPT(brief, this.history.join('\n'), fresh),
            }).then((t) => parseDecision(t.reply_text)).catch((err) => {
              this.failures++;
              this.say(`Kimi Live falhou no turno (${String(err).slice(0, 120)}) — Operador segue com o que tem`, { failures: this.failures });
              return { kind: 'hold' } as Decision;
            });
            // GUARDA DE ORDEM EXPLÍCITA (decreto owner): act sem ordem direta
            // no turno vira pergunta — nunca ação por conta própria.
            // ATALHO DETERMINÍSTICO (decreto owner, call ao vivo 2026-09-25):
            // ordem de mensagem explícita é executada DIRETO — sem rodada de LLM
            // (latência zero, confiabilidade total pro caso mais comum).
            const RE_MSG_GRUPO = /no grupos+([^,.\"\"“]+?)(?:s+(?:dizendo|escrito|falando|com o texto|ques+diga))?s*["“]?([^"”]{2,})?["”]?$/i;
            const RE_MSG_PARA = /(?:para|pra|pro)s+([^,.\"\"“]+?)(?:s+(?:dizendo|escrito|falando|com o texto|ques+diga))?s*["“]?([^"”]{2,})?["”]?$/i;
            const ordemMsg = /mandw*|enviw*/i.test(ultimo.text) && /mensagem|msg/i.test(ultimo.text)
              ? (RE_MSG_GRUPO.exec(ultimo.text) ?? RE_MSG_PARA.exec(ultimo.text))
              : null;
            if (ordemMsg && ordemMsg[1] && (ordemMsg[2] || /teste|oi|ol[aá]/i.test(ultimo.text))) {
              const alvo = ordemMsg[1].trim();
              const texto = (ordemMsg[2] || 'Testando voz um dois três').trim();
              const acao = { kind: 'act', name: 'wa_msg', detail: `para=${alvo} | texto=${texto}` } as const;
              this.say(`ORDEM DIRETA detectada — executando wa_msg sem LLM (${alvo})`);
              const evidencia = await this.deps.executeAction?.(acao.name, acao.detail).catch((e) => `falhou: ${String(e).slice(0, 100)}`);
              await this.audit('conductor.act', { name: 'wa_msg', evidence: evidencia, ordem_citada: ultimo.text.slice(0, 120) });
              if (evidencia) await this.deps.operator.sendText(tab, `📟 Luna → Operador: Fale para o Abner que ${evidencia}.`).catch(() => {});
              continue;
            }
            const guarded = guardAction(decision, ultimo);
            if (guarded.decision.kind === 'say' && decision.kind === 'act') {
              this.say(`SEM ORDEM EXPLÍCITA — act '${decision.name}' virou pergunta ao owner`);
            }
            const final = guarded.decision;
            if (final.kind === 'say') {
              // BARRAMENTO INTERNO (fix arquitetura 2026-09-25): o texto vai ao
              // chat como INSTRUÇÃO pro Operador com prefixo 📟 — nunca como fala
              // direta pro Abner. O prefixo também marca a mensagem p/ proteção
              // de eco (a conductora ignora os próprios relays ao ler o thread).
              const barramento = `📟 Luna → Operador: ${final.text.replace(/^📟\s*Luna → Operador:\s*/i, '')}`;
              this.say(`digita pro Operador: "${barramento.slice(0, 100)}"`);
              await this.deps.operator.sendText(tab, barramento);
              await this.audit('conductor.say', { text: barramento.slice(0, 150), turno: ultimo.text.slice(0, 100) });
            } else if (final.kind === 'act') {
              this.say(`ação: ${final.name} — ${final.detail.slice(0, 100)} (ordem: "${guarded.ordemCitada}")`);
              let evidence = 'sem executor';
              if (this.deps.executeAction) {
                evidence = await this.deps.executeAction(final.name, final.detail).catch((e) => `falhou: ${String(e).slice(0, 100)}`);
              }
              await this.audit('conductor.act', { name: final.name, evidence, ordem_citada: guarded.ordemCitada ?? null, turno: ultimo.text.slice(0, 100) });
              // ação também vira fala quando couber
              if (evidence && evidence !== 'sem executor') {
                await this.deps.operator.sendText(tab, `📟 Luna → Operador: Fale para o Abner que ${evidence}.`).catch(() => {});
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

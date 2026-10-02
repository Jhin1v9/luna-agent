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
  /** Índice do 1º elemento da transcrição DESTA chamada (snapshot no start). */
  private startCount = 0;
  private lastRelayKey = '';
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

  /** Lê TODOS os elementos da transcrição do ChatGPT (user + assistant). */
  private async readAllTurns(tab: Page): Promise<Array<{ role: string; text: string }>> {
    return ((await tab
      .evaluate(`(() => {
        const out = [];
        document.querySelectorAll('[data-message-author-role]').forEach((el) => {
          out.push({ role: el.getAttribute('data-message-author-role'), text: (el.textContent || '').replace(/\\s+/g, ' ').trim() });
        });
        return out;
      })()`)
      .catch(() => [])) as Array<{ role: string; text: string }>);
  }

  /** Lê turnos novos do chat do ChatGPT (cursor). */
  private async readNewTurns(tab: Page): Promise<ConductorTurn[]> {
    const turns = await this.readAllTurns(tab);
    // PROTEÇÃO DE ECO (fix arquitetura 2026-09-25): mensagens do barramento
    // interno (📟 Luna → Operador:) são relays PRÓPRIOS da conductora voltando
    // no thread — nunca contam como fala de participante.
    const fresh = turns
      .slice(this.cursor)
      .filter((t) => t.text.length > 0 && t.role === 'user' && !t.text.startsWith('📟 Luna → Operador:'));
    this.cursor = turns.length;
    return fresh.map((t) => ({ speaker: 'participante', text: t.text }));
  }

  /**
   * Transcrição DESTA chamada, do início ao fim (decreto owner 27/09 — "não
   * o chat todo, só desde que começou até terminar"). Chamada no encerramento,
   * ANTES de resetar a aba do Operador. Relays internos (📟) entram como
   * contexto do que a Luna ordenou — parte do histórico da chamada.
   */
  async captureTranscript(tab: Page): Promise<Array<{ role: string; text: string }>> {
    const turns = await this.readAllTurns(tab);
    return turns.slice(this.startCount).filter((t) => t.text.length > 0);
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
    // Marca o início da chamada: só o que vier DEPOIS deste snapshot entra
    // na transcrição do call.digest (nunca o histórico velho do chat). O loop
    // aguarda o snapshot antes do 1º poll — senão cursor=0 releria histórico.
    const startReady = this.readAllTurns(tab)
      .then((turns) => {
        this.startCount = turns.length;
        this.cursor = turns.length;
      })
      .catch(() => {});
    const pollMs = this.deps.pollMs ?? 3_000;
    const loop = async (): Promise<void> => {
      await startReady;
      while (this.running) {
        try {
          const fresh = [...(await this.readVoiceNew(tab)), ...(await this.readNewTurns(tab))].slice(0, 6);
          if (fresh.length > 0) {
            for (const turno of fresh) {
              this.history.push(`- ${turno.speaker}: ${turno.text}`.slice(0, 200));
              if (this.history.length > 12) this.history.shift();
            }
            // RELAY DIRETO (decreto owner 2026-09-25): TODA a transcript vai
            // crua pra sessão Kimi Web (tools + brain + painel). Ela entende a
            // intenção — ORDENS executa com tools, PERGUNTAS consulta quando
            // preciso (ex.: "último pedido da Jess" = olhar o brain/painel) — e
            // responde no formato de instrução pro Operador. Zero regex, zero
            // protocolo JSON no meio.
            const transcript = fresh.map((t) => `${t.speaker}: ${t.text}`).join('\n');
            // COALESCE: captions de voz evoluem por acréscimo entre polls — só
            // relay quando a fala mais recente MUDOU (uma fala = um relay).
            const relayKey = fresh[fresh.length - 1]!.text.slice(0, 120);
            if (relayKey !== this.lastRelayKey) {
            this.lastRelayKey = relayKey;
            const reply = await this.deps.live.sendTurn({
              session_key: `conductor:${this.deps.correlationId ?? 'call'}`,
              prompt: [
                '[CHAMADA AO VIVO — novas falas na transcrição, em tempo real]',
                transcript,
                '',
                "Regras deste turno: se a fala pede algo (ORDEM), EXECUTE com suas tools agora e responda com o resultado.",
                "Se é uma PERGUNTA cuja resposta exige dado (brain/painel/arquivos), CONSULTE com as tools antes de responder.",
                "Responda SEMPRE no formato de instrução pro Operador (ele é a voz do Abner):",
                '"Fale para o Abner que <resultado/ resposta>." — curto, PT-BR, personalidade Luna.',
              ].join('\n'),
            }).catch((err) => {
              this.failures++;
              this.say(`Kimi Web fora (${String(err).slice(0, 80)}) — segue sem copiloto`);
              return null;
            });
            if (reply && reply.reply_text && reply.reply_text.trim()) {
              const texto = reply.reply_text.trim().replace(/^📟s*Luna → Operador:s*/i, '');
              this.say(`relay: "${texto.slice(0, 90)}"`);
              await this.deps.operator.sendText(tab, `📟 Luna → Operador: ${texto}`).catch(() => {});
              await this.audit('conductor.relay', { texto: texto.slice(0, 160), turnos: fresh.length });
            }
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

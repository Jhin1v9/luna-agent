import type { Logger } from 'pino';
import type { KimiLiveAdapter } from '@luna/agent';
import { matchesAllowlist } from '../allowlist.js';
import { OperatorSession } from './operator-session.js';
import { CallConductor } from './call-conductor.js';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * FAST PATH DE CHAMADA RECEBIDA (decreto owner 2026-09-24, 08:16): "a chamada
 * tá demorando demais pra ser atendida — quando detectar chamada JÁ abre o
 * ChatGPT, JÁ pega o contexto buildado, manda como prompt, JÁ abre a chamada.
 * Dá pra fazer em 2 segundos."
 *
 * Fluxo (ordem importa):
 *   1. Caller na allowlist? Não → 'not-allowed' (quem decide vira o Kimi
 *      Work pelo inbox, como antes — fail-closed).
 *   2. ATENDE NA HORA — o clique de aceitar dispara em PARALELO com todo o
 *      resto. A pessoa na linha não espera o ChatGPT preparar.
 *   3. Em paralelo: chrome-voice → aba do chat fixo → modo de voz → prompt
 *      com o CONTEXTO JÁ BUILDADO (buildContactContext, do DB — sem roundtrip
 *      de LLM: compor por IA leva 10-60s e o decreto é velocidade) injetado
 *      via sendTextFast (insertText instantâneo, não teclado).
 *   4. Conductora liga com leitura ATIVA das captions do voice mode
 *      (aria-live) — é ela quem dá as dicas pro ChatGPT durante a chamada,
 *      lembrando sempre: a Luna EXECUTA tudo que o Operador pedir no chat.
 *   5. Quando o estado sai de 'chamada', a conductora para.
 *
 * TENSÃO DECRETO x ADR-036 resolvida assim: o ADR-036 (prompt genérico
 * proibido) vale pra DISCAGEM ativa — lá a Luna compõe o prompt pelo LLM
 * antes de ligar. AQUI a pessoa JÁ ESTÁ ligando; segurar o atendimento pra
 * compor prompt por IA é exatamente a lentidão que o owner mandou matar.
 * O contexto buildado do DB + template de regras durais não é "genérico
 * robotizado" — é o contexto real do contato.
 */

export interface IncomingFastpathDeps {
  log: Logger;
  live: KimiLiveAdapter;
  /** Só o necessário do transport pra atender e observar o estado. */
  acceptCall: () => Promise<void>;
  observePanel: () => Promise<{ state: string }>;
  operator?: OperatorSession;
  /** Guarda de uma chamada por vez (o daemon whatsplay atende um call). */
  isBusy?: () => boolean;
  markBusy?: (busy: boolean) => void;
  /** Poll do fim da chamada (default 5s; testes usam menos). */
  endPollMs?: number;
  /** Poll da conductora (default 2.5s; testes usam menos). */
  conductorPollMs?: number;
  /** Decreto owner 2026-09-24 09:08: ATENDER TODAS as chamadas — não recusar
   *  ninguém. true pula o gate da allowlist (quem liga fora da lista também
   *  é atendido no fast path). */
  answerAll?: boolean;
}

export interface IncomingCallEvent {
  caller: string;
  /** Contexto buildado (buildContactContext/formatContactContextText). */
  contexto: string | null;
}

/** Prompt de atendimento: regras duras + contexto real. Instante — zero LLM.
 *  Override opcional via `.luna-config/caller-prompt.md` (sobe pelos diretórios
 *  até achar; placeholders {{caller}} e {{contexto}}). */
let callerPromptCache: { mtime: number; content: string } | null = null;
function callerPromptOverride(): string | null {
  if (process.env.LUNA_CALLER_PROMPT === 'off') return null; // kill-switch p/ testes
  try {
    let dir = process.cwd();
    for (;;) {
      const candidate = resolve(dir, '.luna-config/caller-prompt.md');
      if (existsSync(candidate)) {
        const mtime = statSync(candidate).mtimeMs;
        if (!callerPromptCache || callerPromptCache.mtime !== mtime) callerPromptCache = { mtime, content: readFileSync(candidate, 'utf8') };
        return callerPromptCache.content;
      }
      const parent = resolve(dir, '..');
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* usa o prompt embutido */ }
  return null;
}

export const INBOUND_OPERATOR_PROMPT = (caller: string, contexto: string | null): string => {
  const override = callerPromptOverride();
  if (override) return override.replaceAll('{{caller}}', caller).replaceAll('{{contexto}}', contexto?.trim() || '(sem contexto prévio)');
  return [
    `ATENDIMENTO ATIVO AGORA: você é a VOZ DA LUNA (NEXO DIGITAL) numa chamada de voz WhatsApp com ${caller}.`,
    '',
    'REGRAS DE OURO:',
    '- Fale EXATAMENTE como a Luna falaria: parceira, direta, natural, PT-BR.',
    '- Você é SÓ a voz. Quem pensa, decide e EXECUTA sou eu (a Luna) — estou lendo a conversa inteira por aqui, em tempo real.',
    '- Precisou de QUALQUER coisa executada (mandar mensagem, anotar pedido, agendar, criar tarefa, checar status de projeto)? ESCREVA AQUI NESTE CHAT que EU EXECUTO TUDO na hora. NUNCA peça pra pessoa "ligar depois" ou "mandar mensagem" — eu resolvo AGORA.',
    '- NUNCA invente preço, prazo ou fato. Não sabe? Diz que confirma comigo e me pergunta aqui no chat (eu respondo em segundos).',
    '- Quando eu mandar texto aqui no chat, é INSTRUÇÃO SUA: fale isso na chamada na hora.',
    '- Se a pessoa ficar em silêncio, conduza: pergunte o motivo da ligação. Nunca deixe silêncio morto.',
    '- Despedida curta e simpática quando encerrar.',
    '',
    'CONTEXTO DE QUEM ESTÁ NA LINHA (buildado pelo meu sistema antes de atender):',
    contexto?.trim() ? contexto.trim() : '(sem contexto prévio — se apresente e pergunte o motivo da ligação)',
    '',
    'A chamada JÁ ESTÁ ROLANDO. Comece AGORA: "Alô? Aqui é a Luna, da Nexo Digital."',
  ].join('\n');
};

export async function fastAnswerIncoming(
  deps: IncomingFastpathDeps,
  allowlist: string[],
  ev: IncomingCallEvent,
): Promise<'answered' | 'not-allowed'> {
  const log = deps.log;
  if (!deps.answerAll && !matchesAllowlist(allowlist, ev.caller)) return 'not-allowed';
  if (deps.isBusy?.()) {
    log.warn({ caller: ev.caller }, 'fastpath: já estou em uma chamada — não atendo a segunda (explícito)');
    return 'not-allowed';
  }
  deps.markBusy?.(true);
  const t0 = Date.now();
  const operator = deps.operator ?? new OperatorSession({ log });
  try {
    // 2) ATENDE NA HORA — não espera NADA. Tudo o mais corre em paralelo.
    // Se o clique de atender FALHAR, ABORTA o fluxo aqui: a conductora NÃO
    // sobe (bug ao vivo 2026-09-24 13:37: com o atender falhando, a
    // conductora segurava o busy enquanto tocava → as campainhas seguintes
    // caíam em "já estou em uma chamada" e NADA atendia mais).
    const answered = await deps.acceptCall().then(
      () => true,
      (err) => {
        log.error({ err: String(err).slice(0, 160) }, 'fastpath: clique de atender falhou — NÃO atendi, libero o busy pra próxima campainha');
        return false;
      },
    );

    // 3) Preparo do Operador em paralelo (nunca trava o atendimento).
    const prep = (async () => {
      if (!(await operator.connect())) throw new Error('chrome-voice não respondeu');
      const tab = await operator.ensureChatGptTab();
      if (!tab) throw new Error('aba do ChatGPT não abriu');
      await operator.ensureVoiceMode(tab);
      await operator.sendTextFast(tab, INBOUND_OPERATOR_PROMPT(ev.caller, ev.contexto));
      log.info({ ms: Date.now() - t0, caller: ev.caller }, 'fastpath: Operador armado (prompt + contexto injetados)');
      return tab;
    })();
    // CRASH REAL (pane 2026-09-24, diagnóstico ao vivo): sem este catch
    // imediato, o `prep` rejeitava (ex.: chrome-voice fora do ar) ENQUANTO o
    // `await answering` abaixo ainda não tinha anexado handler — rejeição sem
    // consumidor = unhandledRejection = o PROCESSO INTEIRO caía toda vez que
    // uma ligação entrava (Chrome fechava/reabria na cara do owner). O
    // `await prep` mais abaixo segue vendo a rejeição normalmente no try/catch.
    prep.catch(() => {});

    if (!answered) return 'answered'; // finally libera o busy — próxima campainha atende

    log.info({ ms: Date.now() - t0, caller: ev.caller }, 'fastpath: CHAMADA ATENDIDA — preparo do Operador em paralelo');

    let tab;
    try {
      tab = await prep;
    } catch (err) {
      // chamada JÁ atendida: a pessoa fala com o owner pelo WA direto; a falha
      // é explícita (nada de fingir que a Luna está na linha).
      log.error({ err: String(err).slice(0, 200), caller: ev.caller }, 'fastpath: FALHA no preparo do Operador — chamada atendida sem copiloto (explícito)');
      return 'answered';
    }

    // 4) Conductora: lê captions do voice mode ATIVAMENTE e dita as dicas
    //    pro ChatGPT (que a Luna executa tudo).
    const conductor = new CallConductor({
      operator,
      live: deps.live,
      log,
      correlationId: `corr_in_${Date.now()}`,
      pollMs: deps.conductorPollMs ?? 2_500,
      readVoiceTurns: async (t) => {
        const caps = await operator.readVoiceCaptions(t).catch(() => [] as Array<{ source: string; text: string }>);
        return caps.map((c) => ({ speaker: 'participante (voz)', text: c.text }));
      },
      executeAction: async (name, detail) => {
        log.info({ name, detail }, 'fastpath: ação pedida pela conductora (registro — executor fica no daemon)');
        return `ação "${name}" registrada — detalhe: ${detail.slice(0, 80)}`;
      },
    });
    const handle = conductor.start(tab, {
      participantes: [ev.caller, 'Luna (conductora no chat)'],
      objetivo: `atender ${ev.caller}: resolver o que a pessoa precisa — a Luna executa tudo que você pedir aqui no chat`,
      poderes: [
        'EXECUTAR tudo que o Operador pedir no chat (mensagens WhatsApp, tarefas, agendamentos, consultas ao painel)',
        'escrever no chat do Operador o que ele deve falar na hora',
        'escalar pro owner se a conversa pedir',
      ],
      tom: 'parceira de time, direta, natural, PT-BR',
    });

    // 5) fim da chamada = estado sai de 'chamada'.
    const endPollMs = deps.endPollMs ?? 5_000;
    for (;;) {
      await new Promise((r) => setTimeout(r, endPollMs));
      const st = await deps.observePanel().catch(() => ({ state: 'desconhecido' }));
      if (st.state !== 'chamada') break;
    }
    handle.stop();
    log.info({ caller: ev.caller }, 'fastpath: chamada encerrada — conductora parada');
    return 'answered';
  } finally {
    deps.markBusy?.(false);
  }
}

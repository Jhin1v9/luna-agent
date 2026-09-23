import type { Logger } from 'pino';
import type { KimiLiveAdapter } from '@luna/agent';
import type { OperatorSession } from './operator-session.js';
import type { Page } from 'playwright-core';

/**
 * PRÉ-VIOO DO OPERADOR (decreto owner, ordem INVERTIDA após a 1ª chamada real):
 * nunca mais discar com operador frio (o silêncio de 15-20s da 1ª chamada foi
 * o prompt injetado DEPOIS da conexão).
 *
 * Fluxo: ANTES de discar —
 *   (a) OperatorSession conecta no chrome-voice e garante a aba do ChatGPT;
 *   (b) o PROMPT DO OPERADOR É COMPOSTO PELO KIMI CODE (KimiCliAdapter) com o
 *       contexto da chamada (decreto owner: "quem faz é o kimi code com o
 *       contexto correto, nunca nada genérico robotizado; contexto não é
 *       fixo, é ocasional") e injetado;
 *   (c) AGUARDA A CONFIRMAÇÃO de que o Operador está ativo (resposta na
 *       conversa) — loga "operador ativo ✅" antes de prosseguir;
 *   (d) SÓ ENTÃO disca (placeVoiceCall fica a cargo do caller/orquestrador).
 *
 * FALLBACK duro (ADR-036): Kimi CLI falho → FALHA EXPLÍCITA, sem prompt
 * genérico, sem discagem. Melhor não ligar do que operar robótico.
 */

export interface CallBrief {
  /** Destinatário da chamada (ex.: 'Pai'). */
  destinatario: string;
  /** Número/jid se conhecido. */
  numero?: string;
  /** Quem autoriza (owner). */
  autorizador: string;
  /** Por que a chamada existe. */
  motivo: string;
  /** O que a Luna precisa que o Operador faça. */
  objetivo: string;
}

export interface PreflightDeps {
  operator: OperatorSession;
  live: KimiLiveAdapter;
  log?: Logger;
  /** Espera da confirmação do operador (default 20s). */
  timeoutMs?: number;
  /** Poll da confirmação (default 2s). */
  pollMs?: number;
  /** Injetável p/ testes. */
  now?: () => number;
}

const COMPOSE_PROMPT = (brief: CallBrief): string =>
  [
    'Você é o Kimi Code compondo o PROMPT DO OPERADOR para uma chamada de voz (contrato §26).',
    'Escreva APENAS o texto do prompt (em PT-BR), em 2ª pessoa dirigida ao Operador (ChatGPT voz),',
    'incorporando personalidade §26 + os fatos OCASIONAIS desta chamada — nada de texto genérico/robotizado.',
    '',
    `Destinatário: ${brief.destinatario}${brief.numero ? ` (${brief.numero})` : ''}`,
    `Autorizando: ${brief.autorizador} (owner)`,
    `Motivo da chamada: ${brief.motivo}`,
    `O que o Operador deve fazer: ${brief.objetivo}`,
    '',
    'Regras do prompt final: o Operador é a voz da Luna (NEXO DIGITAL); nunca inventa fatos/preços/prazos;',
    'mantém a conversa viva (marca de espera padrão quando processando); trata a Luna como colega;',
    'e SEMPRE se despede curto e simpático ao encerrar.',
  ].join('\n');

/** Confirmação = resposta do assistente apareceu na conversa. */
async function waitOperatorActive(
  operator: OperatorSession,
  tab: Page,
  timeoutMs: number,
  pollMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const reply = await operator.readLatestReply(tab);
    if (reply && reply.trim().length > 0) return reply;
    if (Date.now() >= deadline) return '';
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/**
 * Executa o pré-voo. Resolve com a aba do Operador ATIVO (pronta pra falar
 * na hora quando o destinatário atender). Rejeita com falha explícita ANTES
 * de qualquer discagem quando: Kimi CLI falha, chrome-voice fora, ou a
 * confirmação não chega no timeout.
 */
export async function preflightOperator(deps: PreflightDeps, brief: CallBrief): Promise<Page> {
  const log = deps.log;
  const timeoutMs = deps.timeoutMs ?? 20_000;
  const pollMs = deps.pollMs ?? 2_000;
  const say = (msg: string, extra?: object): void => {
    log?.info(extra ?? {}, `preflight: ${msg}`);
  };

  // (b) composição do prompt PELO KIMI CODE — falha aqui = aborto total.
  let promptText: string;
  try {
    const turn = await deps.live.sendTurn({
      session_key: `operator:prompt:${brief.destinatario}`,
      prompt: COMPOSE_PROMPT(brief),
    });
    promptText = turn.reply_text.trim();
    if (!promptText) throw new Error('resposta vazia');
    say(`prompt do Operador composto pelo Kimi Code (${promptText.length} chars)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.error({ err: msg }, 'preflight: FALHA ao compor o prompt do Operador (Kimi CLI) — ABORTO, sem prompt genérico, sem discar');
    throw new Error(`pré-voo abortado: Kimi CLI falhou ao compor o prompt do Operador (${msg.slice(0, 200)}) — não vou discar com operador robótico`);
  }

  // (a) conecta no chrome-voice e garante a aba
  const connected = await deps.operator.connect();
  if (!connected) {
    throw new Error('pré-voo abortado: chrome-voice não respondeu — não vou discar com operador frio');
  }
  const tab = await deps.operator.ensureChatGptTab();
  if (!tab) {
    throw new Error('pré-voo abortado: aba do ChatGPT não abriu — não vou discar com operador frio');
  }

  // (b2) injeta o prompt COMPOSTO
  await deps.operator.sendText(tab, promptText);
  say('prompt composto injetado no ChatGPT — aguardando o Operador confirmar atividade');

  // (c) confirmação
  const reply = await waitOperatorActive(deps.operator, tab, timeoutMs, pollMs);
  if (!reply) {
    log?.error({ timeout_ms: timeoutMs }, 'preflight: Operador NÃO confirmou atividade a tempo — ABORTO, sem discagem');
    throw new Error(`pré-voo abortado: Operador não confirmou em ${Math.round(timeoutMs / 1000)}s — não vou discar`);
  }
  say(`operador ativo ✅ ("${reply.slice(0, 80)}") — autorizado a discar`);
  return tab;
}

/**
 * Orquestrador da chamada consciente (pré-voo → discar). O dialer é injetado
 * (placeVoiceCall do transport) — e NUNCA é chamado quando o pré-voo falha.
 */
export async function runVoiceCall(
  deps: PreflightDeps,
  brief: CallBrief,
  dialer: () => Promise<void>,
): Promise<'called'> {
  await preflightOperator(deps, brief);
  await dialer();
  return 'called';
}

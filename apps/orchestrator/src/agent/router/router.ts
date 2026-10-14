import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { EventEnvelope } from '@luna/events';
import type { KimiLiveAdapter, TurnResult } from '@luna/agent';
import { publishEvent, enqueueJob, type Sql } from '@luna/database';
import { loadRouterConfig, routeFor, type RouterConfig } from './config.js';
import {
  STRUCTURED_INSTRUCTIONS,
  parseStructured,
  isExplicitHumanRequest,
  type StructuredOutput,
} from './structured.js';
import { runTool, toolNames, type ToolContext } from './tools.js';

/**
 * Model Router (contrato v1.1) — enrutamento DETERMINÍSTICO por event_type
 * (zero IA no roteamento, §10.4). Este módulo executa o destination=fast com
 * saídas estruturadas (§5) e guardas de bucle (§5.1); destination=live e a
 * investigação em si ficam registrados como handoff estruturado (ADR-023 —
 * kimi-web WS ainda opaco).
 */

export const TOOL_CALL_MAX_ITERATIONS = 5; // §5.1
export const HANDOFF_MAX_PER_EVENT = 1;

/** REGRA OWNER 14/10: nunca a mesma mensagem de espera duas vezes — rotação
 *  de acks naturais, tom humano de WhatsApp. */
const HANDOFF_ACKS = [
  'Deixa eu ver isso direitinho — já te falo aqui, tá?',
  'Hmm, peraí que vou olhar isso aqui já já',
  'Vou checar isso rapidinho, já volto com você 🌙',
  'Deixa eu dar uma olhada nisso — já já te dou o retorno aqui',
  'Opa, deixa eu ver isso com calma — já te respondo, tá?',
  'Boa, vou ver isso agora — segura aí que já te falo',
];
const handoffAck = (): string => HANDOFF_ACKS[Math.floor(Math.random() * HANDOFF_ACKS.length)]!; // §5.1 — via de sentido único

export interface RouterDecision {
  /** O que o handler deve entregar ao cliente (ANSWER de espera em handoff). */
  answerText: string;
  /** Uso real do turno vencedor (usage ledger). */
  turn: TurnResult;
  /** Saída estruturada final. */
  output: StructuredOutput;
  /** Rondas de tool executadas (evidência das guardas). */
  toolRounds: number;
  handoff: boolean;
  escalate: boolean;
}

export interface RouterDeps {
  pool: Pool;
  adapter: KimiLiveAdapter;
  log: Logger;
  config?: RouterConfig;
}

interface TurnTrace {
  output: StructuredOutput;
  turn: TurnResult;
  toolRounds: number;
}

async function structuredTurn(
  deps: RouterDeps,
  prompt: string,
  sessionKey: string,
  toolRounds: number,
  imageBase64?: string,
): Promise<TurnTrace> {
  const toolBlock =
    toolRounds < TOOL_CALL_MAX_ITERATIONS
      ? `\nTools disponíveis (somente leitura): ${toolNames().join(', ')}.`
      : '\nVocê JÁ atingiu o tope de chamadas de tool neste evento — responda ANSWER, HANDOFF_LIVE ou ESCALATE_HUMAN.';
  const turn = await deps.adapter.sendTurn({
    session_key: sessionKey,
    prompt: `${STRUCTURED_INSTRUCTIONS}\n${toolBlock}\n\n---\n${prompt}`,
    ...(imageBase64 ? { image_base64: imageBase64 } : {}),
  });
  const { output, degraded } = parseStructured(turn.reply_text);
  if (degraded) {
    deps.log.warn(
      { raw: turn.reply_text.slice(0, 200), model: turn.model },
      'router: parse degradado — modelo não devolveu JSON estruturado puro',
    );
  }
  return { output, turn, toolRounds };
}

/**
 * §10 algoritmo para destination=fast. Retorna a decisão final; o handler
 * faz a entrega. Pedido explícito de humano (§8.1) sai antes de qualquer IA.
 */
export async function runFastRoute(deps: RouterDeps, input: {
  event: EventEnvelope;
  prompt: string;
  sessionKey: string;
  allowLiveHandoff: boolean;
  /** Vision (owner 27/09): imagem da mensagem em base64 — vai no 1º turno. */
  imageBase64?: string;
  /** Config da route (§4, routes.json) — budget de rondas e timeout da
   *  investigação. Defaults só se a route não trouxer. */
  investigationBudget?: number;
  investigationTimeoutMs?: number;
}): Promise<RouterDecision> {
  const { event, prompt, sessionKey } = input;
  const allowLiveHandoff = input.allowLiveHandoff;
  const budget = input.investigationBudget ?? 3;
  const timeoutMs = input.investigationTimeoutMs ?? 600_000;
  const clientText = (event.payload as { text?: string }).text ?? '';

  // §8.1 — pedido explícito de humano: escalación imediata, ZERO tentativas de IA.
  if (isExplicitHumanRequest(clientText)) {
    deps.log.info({ event_id: event.event_id }, 'router: pedido explícito de humano — escalación imediata (§8.1)');
    return {
      answerText:
        'Claro! Já chamei o time — quem puder te atende agora. Enquanto isso, se quiser deixar mais detalhes, eu anoto tudo pra eles.',
      turn: { reply_text: '', session_id: 'router:no-ai', duration_ms: 0 },
      output: { type: 'ESCALATE_HUMAN', reason: 'pedido explícito de humano no texto do cliente', priority: 'ALTA', summary: clientText.slice(0, 200) },
      toolRounds: 0,
      handoff: false,
      escalate: true,
    };
  }

  const ctx: ToolContext = { conversationId: sessionKey, clientId: event.client_id };
  let trace = await structuredTurn(deps, prompt, sessionKey, 0, input.imageBase64);

  // §10.2/§5.1 — loop FAST↔tool, tope de 5 iterações.
  while (trace.output.type === 'TOOL_CALL' && trace.toolRounds < TOOL_CALL_MAX_ITERATIONS) {
    const call = trace.output;
    deps.log.info({ tool: call.tool, event_id: event.event_id }, 'router: TOOL_CALL — executando tool');
    const result = await runTool(deps.pool, ctx, call.tool, call.args);
    const backToFast = [
      prompt,
      '',
      `Resultado da tool "${call.tool}" (rodada ${trace.toolRounds + 1}):`,
      JSON.stringify(result).slice(0, 1500),
      '',
      'Com esse dado, responda com o JSON final (ANSWER / HANDOFF_LIVE / ESCALATE_HUMAN).',
    ].join('\n');
    trace = await structuredTurn(deps, backToFast, sessionKey, trace.toolRounds + 1);
  }

  const output = trace.output;

  // §5.1 — HANDOFF_LIVE: máx 1 por evento. Como é a 1ª e única via, ok.
  if (output.type === 'HANDOFF_LIVE' && allowLiveHandoff && HANDOFF_MAX_PER_EVENT === 1) {
    await publishEvent(deps.pool, {
      event_type: 'router.handoff.live',
      source: 'model_router',
      client_id: event.client_id,
      conversation_id: event.conversation_id,
      correlation_id: event.correlation_id,
      causation_id: event.event_id,
      payload: {
        objective: output.objective,
        budget,
        timeout_ms: timeoutMs,
        context_summary: output.context_summary,
      },
    });
    // P2 (ADR-034): live brain real (KimiCliAdapter) — o HANDOFF vira job
    // `investigate` no worker: budget de rondas + timeout de parede, resposta
    // entregue no MESMO thread. Idempotente por evento (§7.6).
    const eventPayload = event.payload as { chat_id?: string; author_name?: string; deliver?: boolean };
    await enqueueJob(deps.pool, {
      job_type: 'investigate',
      payload: {
        objective: output.objective,
        context_summary: output.context_summary,
        conversation_id: event.conversation_id,
        client_id: event.client_id,
        correlation_id: event.correlation_id,
        chat_id: eventPayload.chat_id ?? null,
        author_name: eventPayload.author_name ?? null,
        budget,
        timeout_ms: timeoutMs,
      },
      priority: 5,
      max_attempts: 1,
      idempotency_key: `investigate:${event.event_id}`,
    });
    return {
      answerText: handoffAck(),
      turn: trace.turn,
      output,
      toolRounds: trace.toolRounds,
      handoff: true,
      escalate: false,
    };
  }

  if (output.type === 'ESCALATE_HUMAN') {
    return {
      answerText: 'Claro! Já chamei o time — quem puder te atende agora.',
      turn: trace.turn,
      output,
      toolRounds: trace.toolRounds,
      handoff: false,
      escalate: true,
    };
  }

  // SILENCE (decreto owner 14/10): passa INTACTO pro handler — lá a decisão
  // vira audit + conversa RESOLVED, sem outbound. Bug ao vivo 05:38 UTC: o
  // catch-all de ANSWER daqui degradava SILENCE pra ANSWER com o JSON cru,
  // e o grupo recebia o "pensamento" literal da Luna.
  if (output.type === 'SILENCE') {
    return {
      answerText: '',
      turn: trace.turn,
      output,
      toolRounds: trace.toolRounds,
      handoff: false,
      escalate: false,
    };
  }

  // ANSWER (ou degradação de parse → ANSWER com o texto cru).
  // HANDOFF sem live-handoff disponível também cai aqui: §6/§8 — o cliente
  // recebe a MENSAGEM DE CORTESIA de espera, nunca o JSON do structured
  // output (bug ao vivo 2026-09-22: envelope ia literal pro canal).
  const text =
    output.type === 'ANSWER'
      ? output.text
      : output.type === 'HANDOFF_LIVE'
        ? handoffAck()
        : trace.turn.reply_text;
  return {
    answerText: text,
    turn: trace.turn,
    output: output.type === 'ANSWER' ? output : { type: 'ANSWER', text },
    toolRounds: trace.toolRounds,
    handoff: false,
    escalate: false,
  };
}

/** Seleção de route + evento router.route.selected / router.default.used (§11). */
export async function selectRoute(deps: RouterDeps, event: EventEnvelope): Promise<{
  destination: 'fast' | 'live';
  allowLiveHandoff: boolean;
  timeoutMs: number;
  contextPack: string;
  investigationBudget: number;
  investigationTimeoutMs: number;
}> {
  const config = deps.config ?? loadRouterConfig();
  const { route, defaulted } = routeFor(config, event.event_type);
  await publishEvent(deps.pool, {
    event_type: defaulted ? 'router.default.used' : 'router.route.selected',
    source: 'model_router',
    client_id: event.client_id,
    conversation_id: event.conversation_id,
    correlation_id: event.correlation_id,
    causation_id: event.event_id,
    payload: { event_type: event.event_type, destination: route.destination, route: event.event_type in config.routes ? event.event_type : null },
  }).catch(() => {});
  return {
    destination: route.destination,
    allowLiveHandoff: route.allow_live_handoff,
    timeoutMs: route.timeout_ms,
    contextPack: Array.isArray(route.context_pack) ? route.context_pack[0] : route.context_pack,
    investigationBudget: route.investigation_budget,
    investigationTimeoutMs: route.investigation_timeout_ms,
  };
}

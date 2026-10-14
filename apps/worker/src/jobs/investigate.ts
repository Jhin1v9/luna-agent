import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { KimiLiveAdapter } from '@luna/agent';
import { publishEvent, recordAudit } from '@luna/database';
import { sendTeamMessage, type TelegramConfig } from '@luna/channels';
import type { JobHandler, JobRow } from './poller.js';
import type { LiveToolRunner } from './live-tools.js';

/**
 * Investigação HANDOFF_LIVE — envio ÚNICO (decreto owner 2026-09-26:
 * "enviar só 1x, depois esquece").
 *
 * Por que single-send (contexto do incidente 2026-09-26): o prompt de
 * investigação estava sendo repetido dezenas de vezes na sessão do Cérebro
 * Vivo para UM único pedido do owner ("trocar o número dele no brain").
 * Três multiplicadores se combinaram:
 *   1. eventos duplicados do mesmo inbound (replay de backlog) → 2 jobs;
 *   2. LOCK_REAPER_TIMEOUT_MS = 5 min devolve o job 'running' para a fila
 *      enquanto o turno do live brain ainda aguarda resposta → o poller
 *      reexecuta o MESMO job → 2º sendTurn idêntico;
 *   3. budget de rondas reenviava o objetivo a cada ronda.
 *
 * Novo contrato:
 *   · UM único sendTurn por pedido, com a tarefa completa e instrução de
 *     concluir com "CONCLUSAO_PRONTA:" + resposta final;
 *   · dedupe por objetivo+conversa (24h): pedido repetido NÃO reenvia;
 *   · marca de despacho idempotente (inv-dispatch:<job>): re-execução do
 *     mesmo job (reaper) NÃO reenvia;
 *   · falha/timeout do turno → ESCALATE_HUMAN com motivo, sem retry e sem
 *     reenvio (o job completa — nunca propaga erro para re-tentativa).
 *
 * Conclusão entregue NO MESMO thread (messages outbound + NOTIFY
 * luna_outbound — send-safety do whatsplay). Eventos do contrato §11.
 */

export interface InvestigateDeps {
  pool: Pool;
  live: KimiLiveAdapter;
  log: Logger;
  telegram?: TelegramConfig;
  /** ADR-042: live brain API (roda) roda sem ferramentas — prompt adaptado.
   *  Default true (kimi-cli/pi/kimi-web-local têm ferramentas reais). */
  liveHasTools?: boolean;
  /** ADR-042 complemento (owner 14/10): quando o live brain é a roda, o
   *  WORKER executa as tools (filesystem/shell) num loop com o modelo —
   *  o modelo pede {"action":"tool",...} e recebe o resultado. */
  workerTools?: LiveToolRunner;
  workerToolMaxRounds?: number; // default 6
}

interface InvestigatePayload {
  objective: string;
  context_summary?: string;
  conversation_id: string;
  client_id?: string;
  correlation_id?: string;
  chat_id?: string;
  author_name?: string;
  budget?: number; // legado — ignorado (single-send); mantido p/ compat. do payload do router
  timeout_ms?: number;
}

interface Round {
  round: number;
  finding: string;
  duration_ms: number;
}

const SINGLE_PROMPT_TOOLS = (objective: string, context: string): string =>
  [
    'Você é a Luna no CÉREBRO VIVO (investigação HANDOFF_LIVE). Você tem FERRAMENTAS REAIS,',
    'incluindo ESCRITA: Write, Edit, Read, Grep/Glob e Bash. EXECUTE a tarefa de verdade com',
    'elas (gravar arquivos, editar código, chamar APIs) — NUNCA alegue que só tem leitura.',
    `O repositório do projeto é C:/Users/Abner/Documents/Luna cto/luna-agent (use caminhos absolutos).`,
    '',
    `TAREFA DESTA INVESTIGAÇÃO: ${objective}`,
    context ? `Contexto do FAST: ${context}` : '',
    'EXECUTE a tarefa agora (não peça confirmação, não peça contexto — o objetivo acima é completo).',
    'Esta é a ÚNICA chamada que você vai receber para este pedido: faça tudo nesta resposta.',
    'Termine a resposta com a linha "CONCLUSAO_PRONTA:" seguida da RESPOSTA FINAL para o cliente',
    '(direta, em PT-BR, sem mencionar ferramentas). Se de fato não for possível concluir, escreva',
    '"NÃO RESOLVIDO: <motivo>" no lugar do marcador.',
  ]
    .filter(Boolean)
    .join('\n\n');

/** ADR-042 complemento (owner 14/10) — live brain na roda COM ferramentas:
 *  o worker executa filesystem/shell. O modelo conversa em JSON: pede tool
 *  ou entrega o final. listTools está sempre disponível pro modelo descobrir
 *  o catálogo completo (decreto owner: "o live brain deve ver a lista de
 *  tools — ler arquivos, editar, criar, tudo igual a Luna"). */
const SINGLE_PROMPT_WORKER_TOOLS = (objective: string, context: string, roots: string[]): string =>
  [
    'Você é a Luna no CÉREBRO VIVO (investigação HANDOFF_LIVE, modo API COM FERRAMENTAS).',
    'Você tem braços reais: um worker executa filesystem e shell POR VOCÊ, nas raízes',
    `permitidas: ${roots.join(', ')}.`,
    '',
    'REGRA DE OURO: não sabe qual tool usar ou quais argumentos? Chame',
    '{"action":"tool","tool":"listTools","args":{}} — o catálogo completo (descrição +',
    'argumentos de cada tool) volta como resultado.',
    '',
    'Responda SEMPRE com EXATAMENTE um JSON válido (sem texto fora), nestas formas:',
    '{"action":"tool","tool":"nome_da_tool","args":{...}}',
    '{"action":"final","text":"resposta pronta pro WhatsApp"}',
    '',
    'Tools principais: listTools · fs.read · fs.write · fs.edit · fs.list · fs.grep · shell.run',
    '- fs.edit exige old_string EXATO — leia o arquivo com fs.read antes e copie o trecho.',
    '- fs.write cria/sobrescreve arquivo inteiro (cuidado com o que já existe).',
    '- shell.run: um comando bash não-interativo por chamada (timeout 30s).',
    '',
    `TAREFA DESTA INVESTIGAÇÃO: ${objective}`,
    context ? `Contexto que o cérebro rápido juntou: ${context}` : '',
    'EXECUTE de verdade (ler, criar, editar arquivos, rodar comandos). Quando estiver',
    'concluído, responda {"action":"final","text":"..."} — texto direto em PT-BR, pronto',
    'pra mandar no WhatsApp, sem mencionar tools, arquivos nem JSON.',
    'Se de fato não for possível concluir, o text do final começa com "NÃO RESOLVIDO: <motivo>".',
  ]
    .filter(Boolean)
    .join('\n\n');
/** ADR-042 — live brain API (roda) SEM worker-tools: stateless, sem
 *  ferramentas. A tarefa é resolvida com raciocínio + o contexto que o FAST
 *  passou; ação/escrita real fica pro modo com ferramentas — nesse caso o
 *  modelo declara NÃO RESOLVIDO e a Luna responde o grupo com o que dá pra
 *  fazer. */
const SINGLE_PROMPT_NOTOOLS = (objective: string, context: string): string =>
  [
    'Você é a Luna no CÉREBRO VIVO (investigação HANDOFF_LIVE, modo API).',
    'Você NÃO tem ferramentas neste modo: resolva com raciocínio e com os dados',
    'do contexto abaixo — NUNCA finja que executou ação no mundo real.',
    '',
    `TAREFA DESTA INVESTIGAÇÃO: ${objective}`,
    context ? `Contexto que o cérebro rápido juntou: ${context}` : '',
    'Esta é a ÚNICA chamada que você vai receber para este pedido: seja completo',
    'agora. Termine com a linha "CONCLUSAO_PRONTA:" seguida da RESPOSTA FINAL',
    '(direta, em PT-BR, pronta pra mandar no WhatsApp). Se a tarefa exigir ação/',
    'escrita que só o modo com ferramentas consegue executar, escreva',
    '"NÃO RESOLVIDO: <o exatamente que falta>" no lugar do marcador.',
  ]
    .filter(Boolean)
    .join('\n\n');

/** Early conclusion: marcador do live brain quando resolveu. */
const CONCLUSION_MARKER = 'CONCLUSAO_PRONTA:';

/**
 * Dedupe SEMÂNTICO (decreto owner 2026-09-26, parte 2): o mesmo pedido chega
 * paráfrase ("Registrar e salvar no brain o número..." vs "Gravar no brain do
 * sistema o número...") e o match exato de `objective` não pega. Comparação
 * por sobreposição de tokens de conteúdo (Jaccard sobre o menor conjunto):
 * mesma intenção reenviada na mesma conversa dentro de 24h → NÃO reenvia.
 * Objetivos cujo job anterior ESCALOU (falhou) ficam de fora da comparação —
 * re-pedido depois de falha é legítimo.
 */
const STOPWORDS = new Set([
  'o', 'a', 'e', 'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'um', 'uma',
  'pra', 'pro', 'pros', 'pras', 'pelo', 'pela', 'pelos', 'pelas', 'que', 'com', 'sem',
  'em', 'ou', 'se', 'eu', 'voce', 'meu', 'minha', 'seu', 'sua', 'esse', 'essa', 'este',
  'esta', 'isto', 'isso', 'ja', 'so', 'mais', 'muito', 'msm', 'mesmo', 'agora', 'aqui',
]);

export function contentTokens(text: string): Set<string> {
  const norm = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const tokens = norm.split(/[^a-z0-9]+/).filter((t) => {
    if (!t) return false;
    if (STOPWORDS.has(t)) return false;
    if (t.length >= 3) return true;
    return /^\d+$/.test(t); // números curtos (ex.: "34") ainda são conteúdo
  });
  return new Set(tokens);
}

export function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}

const SEMANTIC_DUPLICATE_THRESHOLD = 0.6;

export function createInvestigateHandler(deps: InvestigateDeps): JobHandler {
  const { pool, live, log, telegram } = deps;

  async function publish(type: string, payload: InvestigatePayload, extra: Record<string, unknown>): Promise<void> {
    await publishEvent(pool, {
      event_type: type,
      source: 'live_investigation',
      client_id: payload.client_id ?? null,
      conversation_id: payload.conversation_id,
      correlation_id: payload.correlation_id ?? undefined,
      payload: extra,
      idempotency_key: `inv:${payload.correlation_id ?? payload.conversation_id}:${type}:${extra.round ?? extra.outcome ?? 'x'}`,
    });
  }

  async function deliverReply(payload: InvestigatePayload, text: string): Promise<string> {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO messages (conversation_id, direction, channel, sender, body, author_name, metadata, send_state)
       VALUES ($1, 'outbound', 'whatsapp', 'luna', $2, 'Luna', $3, 'queued') RETURNING id`,
      [
        payload.conversation_id,
        text,
        {
          correlation_id: payload.correlation_id ?? null,
          reply_source: 'live_investigation',
          chat_id: payload.chat_id ?? null,
        },
      ],
    );
    const id = inserted.rows[0]!.id;
    await pool.query('SELECT pg_notify($1, $2)', ['luna_outbound', id]);
    return id;
  }

  async function escalateWithSummary(payload: InvestigatePayload, rounds: Round[], reason: string): Promise<void> {
    const summary = [
      `Investigação HANDOFF_LIVE esgotada (${reason}).`,
      rounds.length ? `Rondas:\n${rounds.map((r) => `- R${r.round}: ${r.finding.slice(0, 300)}`).join('\n')}` : 'Sem rondas concluídas.',
    ].join('\n');
    await pool.query(
      `INSERT INTO escalations (client_id, conversation_id, reason, priority, status, notified_at, metadata)
       VALUES ($1, $2, $3, 'ALTA', 'notified', now(), $4)`,
      [
        payload.client_id ?? null,
        payload.conversation_id,
        `handoff_live: ${payload.objective}`.slice(0, 200),
        { summary, trigger: 'investigation_exhausted', correlation_id: payload.correlation_id ?? null },
      ],
    );
    await publish('router.investigation.exhausted', payload, { outcome: 'escalated', reason, rounds: rounds.length });
    if (telegram?.botToken && telegram.teamChatId) {
      try {
        await sendTeamMessage(`🙋 HANDOFF esgotado (${reason}): ${payload.objective}. Resumo das rondas no evento router.investigation.exhausted.`, telegram);
      } catch (err) {
        log.error({ err }, 'investigate: alerta Telegram falhou');
      }
    }
    await recordAudit(pool, {
      actor: 'live_investigation',
      action: 'router.investigation.exhausted',
      tool: 'investigate_job',
      correlation_id: payload.correlation_id ?? null,
      result: 'failed',
      metadata: { reason, rounds: rounds.length },
    });
  }

  return async function investigate(job: JobRow): Promise<void> {
    const payload = job.payload as unknown as InvestigatePayload;

    log.info({ job: job.id, objective: payload.objective }, 'investigate: começando (envio único)');

    // 1) DEDUPE por objetivo — eventos duplicados (backlog replay, double
    //    dispatch do mesmo inbound) NÃO geram um segundo envio. Janela de 24h:
    //    o mesmo pedido reaberto no dia seguinte passa de propósito.
    const dup = await pool.query<{ id: string }>(
      `SELECT id FROM jobs
        WHERE job_type = 'investigate' AND id <> $1
          AND created_at > now() - interval '24 hours'
          AND payload->>'objective' = $2
          AND payload->>'conversation_id' = $3
        ORDER BY created_at ASC LIMIT 1`,
      [job.id, payload.objective, payload.conversation_id],
    );
    if (dup.rowCount) {
      const first = dup.rows[0]!.id;
      await publish('router.investigation.skipped_duplicate', payload, { outcome: 'duplicate', first_job: first });
      await recordAudit(pool, {
        actor: 'live_investigation',
        action: 'router.investigation.skipped_duplicate',
        tool: 'investigate_job',
        correlation_id: payload.correlation_id ?? null,
        result: 'success',
        metadata: { first_job: first },
      });
      log.info({ job: job.id, firstJob: first }, 'investigate: objetivo já enviado nas últimas 24h — skip sem reenvio');
      return;
    }

    // 1b) DEDUPE SEMÂNTICO: mesma intenção em PARÁFRASE (o match exato acima
    //     não pega) já ATENDIDA nesta conversa nas últimas 24h → não reenvia.
    //     Bug ao vivo 14/10: a fonte era `router.investigation.dispatched` —
    //     um pedido só DESPACHADO (e que falhou/capou no live brain) bloqueava
    //     para sempre os re-pedidos legítimos ("só 1x" do decreto vale pro
    //     pedido ATENDIDO — completado com resposta entregue). Turnos que
    //     escalaram (falharam) também são ignorados: re-pedido pós-falha é
    //     legítimo.
    const recent = await pool.query<{ objective: string }>(
      `SELECT DISTINCT payload->'payload'->>'objective' AS objective
         FROM events
        WHERE event_type = 'router.investigation.completed'
          AND recorded_at > now() - interval '24 hours'
          AND conversation_id = $1`,
      [payload.conversation_id],
    );
    if (recent.rowCount) {
      const escalated = await pool.query<{ reason: string }>(
        `SELECT reason FROM escalations
          WHERE created_at > now() - interval '24 hours' AND reason LIKE 'handoff_live:%'`,
      );
      const escalatedObjectives = escalated.rows.map((r) => r.reason.replace(/^handoff_live:\s*/, '').trim());
      const isEscalated = (obj: string): boolean =>
        escalatedObjectives.some((e) => obj.startsWith(e) || e.startsWith(obj));
      const tokens = contentTokens(payload.objective);
      const paraphrase = recent.rows
        .map((r) => r.objective)
        .filter((obj): obj is string => typeof obj === 'string' && obj.trim().length > 0)
        .filter((obj) => !isEscalated(obj.trim()))
        .map((obj) => ({ obj, score: tokenOverlap(tokens, contentTokens(obj)) }))
        .filter((x) => x.score >= SEMANTIC_DUPLICATE_THRESHOLD)
        .sort((a, b) => b.score - a.score)[0];
      if (paraphrase) {
        await publish('router.investigation.skipped_duplicate', payload, {
          outcome: 'duplicate_semantic',
          similar_objective: paraphrase.obj.slice(0, 200),
          score: Number(paraphrase.score.toFixed(2)),
        });
        await recordAudit(pool, {
          actor: 'live_investigation',
          action: 'router.investigation.skipped_duplicate',
          tool: 'investigate_job',
          correlation_id: payload.correlation_id ?? null,
          result: 'success',
          metadata: { semantic: true, score: Number(paraphrase.score.toFixed(2)) },
        });
        log.info(
          { job: job.id, score: paraphrase.score },
          'investigate: paráfrase de objetivo já despachado nas 24h — skip sem reenvio',
        );
        return;
      }
    }

    // 2) MARCA DE DESPACHO idempotente: o reaper de locks (5 min) pode devolver
    //    este job para a fila enquanto o turno ainda aguarda resposta do
    //    Cérebro Vivo. A re-execução encontra a marca e sai SEM reenviar.
    const dispatch = await publishEvent(pool, {
      event_type: 'router.investigation.dispatched',
      source: 'live_investigation',
      client_id: payload.client_id ?? null,
      conversation_id: payload.conversation_id,
      correlation_id: payload.correlation_id ?? undefined,
      payload: { objective: payload.objective.slice(0, 200) },
      idempotency_key: `inv-dispatch:${job.id}`,
    });
    if (dispatch.duplicate) {
      log.info({ job: job.id }, 'investigate: despacho já registrado (reaper double-pick) — skip sem reenvio');
      return;
    }

    // 3) ENVIO ÚNICO (decreto owner: "só 1x, depois esquece") — OU loop de
    //    tools (owner 14/10): quando o live brain é a roda, o worker executa
    //    filesystem/shell e devolve o resultado, até o modelo responder
    //    {"action":"final"}. Sem retry de job: falha/timeout → escalate.
    const startedAt = Date.now();
    const toolRunner = deps.workerTools;
    let finding: string;
    let rounds: Round[];
    if (toolRunner) {
      const maxRounds = deps.workerToolMaxRounds ?? 6;
      const { parseToolStep } = await import('./live-tools.js');
      let conversation = SINGLE_PROMPT_WORKER_TOOLS(
        payload.objective,
        payload.context_summary ?? '',
        toolRunner.roots,
      );
      rounds = [];
      finding = '';
      for (let round = 1; round <= maxRounds; round++) {
        let turnText: string;
        try {
          const turn = await live.sendTurn({
            session_key: `investigate:${job.id}:r${round}`,
            prompt: conversation,
          });
          turnText = turn.reply_text;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error({ err: msg }, 'investigate: envio falhou — escalate sem retry');
          await escalateWithSummary(payload, rounds, `envio falhou/timeout: ${msg.slice(0, 150)}`);
          return;
        }
        const step = parseToolStep(turnText);
        if (step.action === 'final') {
          finding = step.text;
          rounds.push({ round, finding: finding.slice(0, 500), duration_ms: Date.now() - startedAt });
          break;
        }
        // action === 'tool' — o worker executa de verdade e devolve o resultado.
        const result = await toolRunner.run(step.tool, step.args);
        await recordAudit(pool, {
          actor: 'live_investigation',
          action: 'live.tool.run',
          tool: step.tool,
          client_id: payload.client_id ?? null,
          correlation_id: payload.correlation_id ?? null,
          result: result.ok ? 'success' : 'failed',
          metadata: {
            job_id: job.id,
            round,
            args_preview: JSON.stringify(step.args).slice(0, 300),
            error: result.error ?? null,
          },
        });
        rounds.push({ round, finding: `tool ${step.tool}: ${result.ok ? 'ok' : `erro: ${result.error}`}`, duration_ms: Date.now() - startedAt });
        log.info({ job: job.id, round, tool: step.tool, ok: result.ok }, 'investigate: tool executada pelo worker');
        conversation = [
          conversation,
          '',
          `Rodada ${round} — você pediu a tool "${step.tool}". Resultado:`,
          JSON.stringify(result).slice(0, 4000),
          '',
          'Continue: chame outra tool ({"action":"tool",...}) ou, se a tarefa está concluída,',
          'responda {"action":"final","text":"..."} com a resposta pronta pro WhatsApp.',
          'ECONOMIA DE RODADAS: você tem poucas chamadas — explore o mínimo (1-2 leituras)',
          'e execute a tarefa cedo. fs.read já devolve a contagem de linhas (campo "lines").',
        ].join('\n');
      }
      if (!finding) {
        // Rodada bônus: sem tools, só o final — o modelo resume com o que
        // aprendeu nas rodadas (anti-escalada por esgotamento, bug ao vivo
        // 14/10: 6 leituras e nenhum "final" → cliente ficava sem resposta).
        try {
          const turn = await live.sendTurn({
            session_key: `investigate:${job.id}:final`,
            prompt: [
              conversation,
              '',
              `Você esgotou as ${maxRounds} rodadas de tool. AGORA, sem chamar mais nenhuma tool,`,
              'responda APENAS {"action":"final","text":"..."} com o melhor resultado possível',
              'pro WhatsApp: o que conseguiu confirmar + o que ficou pendente (se houver).',
            ].join('\n'),
          });
          const step = parseToolStep(turn.reply_text);
          finding = step.action === 'final' ? step.text : turn.reply_text;
          rounds.push({ round: maxRounds + 1, finding: 'rodada bônus final', duration_ms: Date.now() - startedAt });
        } catch {
          await escalateWithSummary(payload, rounds, `esgotou ${maxRounds} rodadas de tool sem final`);
          return;
        }
      }
    } else {
      try {
        const turn = await live.sendTurn({
          session_key: `investigate:${job.id}`,
          prompt: (deps.liveHasTools ?? true)
            ? SINGLE_PROMPT_TOOLS(payload.objective, payload.context_summary ?? '')
            : SINGLE_PROMPT_NOTOOLS(payload.objective, payload.context_summary ?? ''),
        });
        finding = turn.reply_text;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err: msg }, 'investigate: envio único falhou — escalate sem retry');
        await escalateWithSummary(payload, [], `envio falhou/timeout: ${msg.slice(0, 150)}`);
        return;
      }
      rounds = [{ round: 1, finding, duration_ms: Date.now() - startedAt }];
    }
    for (const round of rounds.slice(0, 3)) {
      await publish('router.investigation.round', payload, {
        round: round.round,
        budget: rounds.length,
        finding: round.finding.slice(0, 500),
      });
    }

    if (/NÃO RESOLVIDO/i.test(finding)) {
      await escalateWithSummary(payload, rounds, 'live brain declarou não-resolvido');
      return;
    }

    let finalText = finding;
    let outcome = 'answered';
    if (finding.includes(CONCLUSION_MARKER)) {
      finalText = finding.split(CONCLUSION_MARKER).slice(1).join(CONCLUSION_MARKER).trim();
      outcome = 'answered_early';
    }
    const messageId = await deliverReply(payload, finalText || finding);
    await publish('router.investigation.completed', payload, {
      outcome,
      rounds: rounds.length,
      reply_message_id: messageId,
    });
    await recordAudit(pool, {
      actor: 'live_investigation',
      action: 'router.investigation.completed',
      tool: 'investigate_job',
      correlation_id: payload.correlation_id ?? null,
      result: 'success',
      metadata: { rounds: rounds.length, early: outcome === 'answered_early', reply_message_id: messageId },
    });
    log.info({ job: job.id, messageId, outcome, rounds: rounds.length }, 'investigate: concluído e entregue no thread');
  };
}

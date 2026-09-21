import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { KimiLiveAdapter } from '@luna/agent';
import { sendTeamMessage, type TelegramConfig } from '@luna/channels';
import { recordAudit, recordActivity } from '@luna/database';
import type { WhatsAppTransport } from './transport.js';
import { appendSelectorMemory } from './selector-memory.js';

/**
 * Auto-reparo visual (v3.1 §14): ação falha → screenshot + DOM simplificado
 * → FAST com VISÃO analisa → nova estratégia → máx 3 tentativas → acerto:
 * aprendizado no selector memory + audit/activity; falha: incident + Telegram
 * vivo com contexto. Visão do kimi-k2.6 validada por probe no boot (ADR-021).
 */

export interface RepairableTransport extends WhatsAppTransport {
  captureEvidence(prefix: string): Promise<{ screenshotPath: string; domPath: string }>;
}

export interface AutoRepairDeps {
  pool: Pool;
  adapter: KimiLiveAdapter;
  transport: RepairableTransport;
  log: Logger;
  telegram?: TelegramConfig;
  maxAttempts?: number; // default 3 (total, §14)
}

interface Analysis {
  diagnosis: string;
  suggested_selector: string | null;
}

/** Parse tolerante do JSON que o FAST devolve. */
export function parseAnalysis(raw: string): Analysis {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const obj = JSON.parse(m ? m[0] : raw) as Partial<Analysis>;
    return {
      diagnosis: typeof obj.diagnosis === 'string' ? obj.diagnosis : raw.slice(0, 300),
      suggested_selector:
        typeof obj.suggested_selector === 'string' && /[.#[]/.test(obj.suggested_selector)
          ? obj.suggested_selector
          : null,
    };
  } catch {
    return { diagnosis: raw.slice(0, 300), suggested_selector: null };
  }
}

const ANALYSIS_PROMPT = (actionName: string, error: string, dom: string) =>
  [
    'Você é a Luna analisando uma falha de automação no WhatsApp Web (Playwright).',
    `Ação que falhou: ${actionName}`,
    `Erro: ${error}`,
    'A imagem anexada é o screenshot da tela no momento da falha; abaixo o DOM simplificado.',
    '',
    dom.slice(0, 2500),
    '',
    'Responda APENAS um JSON: {"diagnosis": "causa provável em uma frase",',
    '"suggested_selector": "seletor CSS alternativo plausível ou null"}.',
  ].join('\n');

export async function withAutoRepair<T>(
  deps: AutoRepairDeps,
  actionName: string,
  context: { conversationTarget?: string; correlationId?: string | null },
  action: (attempt: { suggestedSelector: string | null; attempt: number }) => Promise<T>,
): Promise<T> {
  const max = deps.maxAttempts ?? 3;
  let lastErr: unknown = null;
  let suggested: string | null = null;

  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      const result = await action({ suggestedSelector: suggested, attempt });
      if (attempt > 1) {
        // Recuperado após reparo — aprendizado registrado (§14).
        if (suggested) {
          appendSelectorMemory({
            uso: actionName,
            antigo: '(seletor anterior falhou)',
            novo: suggested,
            fallback: 'screenshot + DOM no incidente',
          });
        }
        await recordAudit(deps.pool, {
          actor: 'whatsplay',
          action: 'auto_repair.recovered',
          tool: 'auto_repair',
          correlation_id: context.correlationId,
          result: 'success',
          metadata: { action: actionName, attempts: attempt, suggested_selector: suggested },
        });
        await recordActivity(deps.pool, {
          kind: 'action',
          summary: `Auto-reparei sozinha: ${actionName} falhou e voltou a funcionar na tentativa ${attempt}.`,
          correlation_id: context.correlationId,
        });
        deps.log.info({ action: actionName, attempts: attempt }, 'auto-reparo: recuperado');
      }
      return result;
    } catch (err) {
      lastErr = err;
      if (attempt >= max) break;
      // Evidência (§14): screenshot + DOM simplificado.
      let dom = '(dom indisponível)';
      let screenshotPath = '';
      try {
        const evidence = await deps.transport.captureEvidence(`repair-${actionName}`);
        screenshotPath = evidence.screenshotPath;
        dom = readFileSync(evidence.domPath, 'utf8').slice(0, 2500);
      } catch {
        // evidência é melhor-esforço; o reparo continua sem ela
      }
      // FAST com visão analisa (ADR-021: k2.6 aceita imagem — probe no boot).
      let analysis: Analysis = { diagnosis: String(err).slice(0, 300), suggested_selector: null };
      try {
        const image = screenshotPath ? readFileSync(screenshotPath).toString('base64') : undefined;
        const turn = await deps.adapter.sendTurn({
          session_key: `repair:${actionName}`,
          prompt: ANALYSIS_PROMPT(actionName, String(err), dom),
          image_base64: image,
        });
        analysis = parseAnalysis(turn.reply_text);
      } catch (err2) {
        deps.log.error({ err: err2 }, 'auto-reparo: análise do FAST falhou — retry sem estratégia nova');
      }
      suggested = analysis.suggested_selector;
      deps.log.warn(
        { action: actionName, attempt, diagnosis: analysis.diagnosis, suggested },
        'auto-reparo: nova estratégia',
      );
    }
  }

  // Esgotou (§14): incidente + Telegram vivo. Sem token = falha explícita
  // registrada (nunca inventar envio).
  const errorMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  await deps.pool.query(
    `INSERT INTO incidents (severity, source, title, description, status)
     VALUES ('critical', 'auto_repair', $1, $2, 'open')`,
    [`Auto-reparo esgotado: ${actionName}`, `Erro: ${errorMsg}. Evidência: screenshot + DOM em .brain/luna/incidents. Alvo: ${context.conversationTarget ?? 'n/d'}`],
  );
  await recordAudit(deps.pool, {
    actor: 'whatsplay',
    action: 'auto_repair.exhausted',
    tool: 'auto_repair',
    correlation_id: context.correlationId,
    result: 'failed',
    metadata: { action: actionName, error: errorMsg },
  });
  if (deps.telegram?.botToken && deps.telegram.teamChatId) {
    try {
      await sendTeamMessage(
        `⚠️ Auto-reparo esgotado (${actionName}) após ${max} tentativas no WhatsPlay. ` +
          `Erro: ${errorMsg}. Evidência em .brain/luna/incidents. Estou segurando a fila.`,
        deps.telegram,
      );
    } catch (err) {
      deps.log.error({ err }, 'auto-reparo: alerta Telegram falhou');
    }
  } else {
    deps.log.error('auto-reparo: TELEGRAM não configurado — alerta NÃO enviado (falha explícita registrada)');
  }
  throw lastErr;
}

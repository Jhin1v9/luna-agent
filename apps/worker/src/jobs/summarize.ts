import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { KimiLiveAdapter } from '@luna/agent';
import { recordAudit } from '@luna/database';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { appendSynapse } from '@luna/brain';

/**
 * Summaries periódicos (§11 "Compaction" / memory promotion): job
 * 'memory.summarize' — clientes com conversa ativa no mês e sem resumo do
 * mês corrente têm o mês resumido pelo FAST; vai pra memory_index
 * (type='summary'), MEMORY.md do cliente no Brain e clients.profile.
 * Lote pequeno por rodada (3 clientes) — barato e incremental.
 */

export interface SummarizeDeps {
  pool: Pool;
  adapter: KimiLiveAdapter;
  log: Logger;
  brainRoot?: string;
  batchSize?: number;
}

const SUMMARY_PROMPT = (clientName: string, month: string, transcript: string) =>
  [
    `Você é a Luna resumindo o mês ${month} de conversas com o cliente ${clientName} (Nexo Digital).`,
    'Responda APENAS um JSON: {"summary": "3-6 frases com o que aconteceu, pedidos,',
    'reclamações, decisões e follow-ups pendentes", "open_points": ["..."]}',
    '',
    'Transcrição (limitada):',
    transcript.slice(0, 3500),
  ].join('\n');

export function createSummarizeHandler(deps: SummarizeDeps) {
  const { pool, adapter, log } = deps;
  const brainRoot = deps.brainRoot ?? 'C:/Users/Abner/Documents/Luna cto/luna-agent/.brain';
  const batch = deps.batchSize ?? 3;

  return async function summarize(_job: { payload: Record<string, unknown> }): Promise<void> {
    const month = new Date().toISOString().slice(0, 7);
    const due = await pool.query<{ id: string; code: string; name: string }>(
      `SELECT c.id, c.code, c.name FROM clients c
       WHERE EXISTS (
         SELECT 1 FROM messages m JOIN conversations cv ON cv.id = m.conversation_id
         WHERE cv.client_id = c.id AND m.created_at > date_trunc('month', now())
       )
       AND NOT EXISTS (
         SELECT 1 FROM memory_index mi WHERE mi.client_id = c.id
           AND mi.type = 'summary' AND mi.path LIKE $1
       )
       ORDER BY c.updated_at DESC LIMIT $2`,
      [`%.brain/clients/%/MEMORY.md#${month}`, batch],
    );
    if (!due.rowCount) {
      log.info('summarize: nenhum cliente pendente de resumo no mês');
      return;
    }

    for (const client of due.rows) {
      try {
        const msgs = await pool.query(
          `SELECT m.author_name, m.direction, m.body FROM messages m
           JOIN conversations cv ON cv.id = m.conversation_id
           WHERE cv.client_id = $1 AND m.created_at > date_trunc('month', now())
           ORDER BY m.created_at ASC LIMIT 60`,
          [client.id],
        );
        const transcript = msgs.rows
          .map((m) => `${m.author_name ?? (m.direction === 'inbound' ? 'cliente' : 'Luna')}: ${m.body}`)
          .join('\n');

        const turn = await adapter.sendTurn({
          session_key: `summarize:${client.id}`,
          prompt: SUMMARY_PROMPT(client.name, month, transcript),
        });
        const candidate = turn.reply_text.match(/\{[\s\S]*\}/)?.[0] ?? turn.reply_text;
        const parsed = JSON.parse(candidate) as { summary?: string; open_points?: string[] };
        if (!parsed.summary) throw new Error('resumo vazio');

        // Brain: MEMORY.md do cliente (append-only, seção mensal).
        const dir = join(brainRoot, 'clients', client.code);
        mkdirSync(dir, { recursive: true });
        const memPath = join(dir, 'MEMORY.md');
        if (!existsSync(memPath)) {
          appendFileSync(memPath, `# Memória — ${client.name}\n\n> Resumos mensais (§11). Append-only.\n\n`, 'utf8');
        }
        appendFileSync(
          memPath,
          `## ${month} — Luna\n\n${parsed.summary}\n\n${(parsed.open_points ?? []).length ? `Pendências: ${parsed.open_points!.map((p) => `- ${p}`).join('\n')}\n\n` : ''}`,
          'utf8',
        );

        await pool.query(
          `INSERT INTO memory_index (client_id, type, path, tags, summary)
           VALUES ($1, 'summary', $2, $3, $4)`,
          [client.id, `.brain/clients/${client.code}/MEMORY.md#${month}`, [month], parsed.summary.slice(0, 300)],
        );
        await pool.query(
          `UPDATE clients SET profile = profile || $2::jsonb, updated_at = now() WHERE id = $1`,
          [client.id, JSON.stringify({ last_monthly_summary: parsed.summary.slice(0, 300), summarized_month: month })],
        );
        appendSynapse({ commit: 'summarize', summary: `resumo mensal de ${client.name} (${month}) gravado no Brain.` }, brainRoot);
        await recordAudit(pool, {
          actor: 'worker',
          action: 'memory.summarized',
          tool: 'summarizer',
          client_id: client.id,
          result: 'success',
          metadata: { month, client: client.code },
        });
        log.info({ client: client.code, month }, 'summarize: resumo mensal gravado');
      } catch (err) {
        log.error({ err, client: client.code }, 'summarize: falha (fail-closed registrado)');
        await recordAudit(pool, {
          actor: 'worker',
          action: 'memory.summarize_failed',
          tool: 'summarizer',
          client_id: client.id,
          result: 'failed',
          metadata: { error: String(err).slice(0, 160) },
        });
      }
    }
  };
}

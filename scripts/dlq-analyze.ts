/**
 * dlq-analyze (P3) — os eventos da dead_letter_events NUNCA são deletados;
 * são analisados. Este script classifica cada entrada por causa provável e
 * (opcional) re-enfileira as falhas transientes via redrive existente.
 *
 * Uso:
 *   pnpm exec tsx scripts/dlq-analyze.ts          # relatório só
 *   pnpm exec tsx scripts/dlq-analyze.ts --fix    # re-enfileira transientes
 */
import pg from 'pg';

const FIX = process.argv.includes('--fix');

function classify(row: { source: string; last_error: string | null; event_id: string | null }): string {
  const e = (row.last_error ?? '').toLowerCase();
  if (!row.event_id) return 'invalid_envelope (sem event_id — payload legado)';
  if (/quota|403|429|rate.?limit/.test(e)) return 'transient_quota';
  if (/timeout|etimedout|econnreset|socket|5\d\d|não chegou em \d+s|varredura kimi work não atendeu/.test(e)) return 'transient_kimiwork';
  if (/resposta vazia|empty/.test(e)) return 'empty_response (já vira retry no kimi-cli)';
  if (/sem handler|handler/.test(e)) return 'missing_handler';
  if (/json|parse|envelope/.test(e)) return 'parse';
  return 'other';
}

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(
      `SELECT event_id, event_type, source, attempts, last_error, reason, created_at
       FROM dead_letter_events ORDER BY created_at DESC`,
    );
    if (rows.length === 0) {
      console.log('DLQ vazia 🎉');
      return;
    }
    const byCause = new Map<string, typeof rows>();
    for (const r of rows) {
      const c = classify(r);
      if (!byCause.has(c)) byCause.set(c, []);
      byCause.get(c)!.push(r);
    }
    console.log(`\n=== DLQ: ${rows.length} eventos (nunca deletados — analisados) ===\n`);
    for (const [cause, list] of byCause) {
      console.log(`\n## ${cause} (${list.length})`);
      for (const r of list.slice(0, 8)) {
        console.log(`  - ${r.event_id ?? '(sem id)'} · ${r.event_type} · ${r.source} · ${r.attempts}tent · ${(r.last_error ?? '').slice(0, 110)}`);
      }
      if (list.length > 8) console.log(`  … e mais ${list.length - 8}`);
    }

    const transientes = rows.filter((r) => ['transient_quota', 'transient_kimiwork', 'transient_net'].includes(classify(r)));
    // Guarda de idade (decisão de engenharia): reprocessar mensagem velha de
    // CLIENTE = responder msg de dias atrás às 1h da manhã — incomoda e é
    // risco de ban. Só reenfileira o que é recente (<24h); o velho fica
    // analisado na DLQ (regra do projeto: não deletar).
    const recentes = transientes.filter((r) => Date.now() - new Date(r.created_at).getTime() < 24 * 60 * 60_000);
    const velhos = transientes.length - recentes.length;
    if (velhos > 0) console.log(`\n${velhos} transientes ANTIGOS (>24h) ficam na DLQ analisados — reprocessar msg velha de cliente incomoda (e é risco de ban).`);
    if (FIX && recentes.length > 0) {
      console.log(`\n--fix: re-enfileirando ${recentes.length} transientes recentes…`);
      const { redriveTransientDeadLetters } = await import('../packages/database/src/redrive.js');
      const res = await redriveTransientDeadLetters(pool as never);
      console.log('redrive:', JSON.stringify(res));
    } else if (recentes.length > 0) {
      console.log(`\n${recentes.length} transientes recentes recuperáveis — rode com --fix para re-enfileirar.`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(String(e).slice(0, 300));
  process.exit(1);
});

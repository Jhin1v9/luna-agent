import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { KimiLiveAdapter } from '@luna/agent';
import { BRAIN_ROOT } from '@luna/brain';
import { publishEvent, recordActivity, recordAudit } from '@luna/database';
import type { JobHandler, JobRow } from './poller.js';

/**
 * call.digest (decreto owner 27/09): quando uma chamada de voz termina, a
 * transcrição DESTA chamada (início→fim, capturada pelo executor antes de
 * resetar a aba do Operador) vai pro FAST classificar: TESTE / LEAD / ORDEM /
 * VALIOSO / DESCARTÁVEL, com pontos-chave e próximos passos. O digest fica em
 * .brain/luna/calls/YYYY-MM.md; LEAD/ORDEM/VALIOSO ainda viram linha de
 * sinapse + activity (o time enxerga sem abrir arquivo).
 */

export interface CallDigestDeps {
  pool: Pool;
  adapter: KimiLiveAdapter; // FAST (cadeia kimi-api) — barato e rápido
  log: Logger;
}

interface DigestPayload {
  transcript_path: string;
  destinatario?: string;
  objetivo?: string;
  correlation_id?: string | null;
  turnos?: number;
}

const CLASSIFY_PROMPT = (meta: string, transcript: string): string =>
  [
    'Você é a Luna analisando a transcrição de UMA chamada de voz que acabou de terminar.',
    'Classifique e extrai o valor. Responda APENAS um JSON válido (sem texto fora):',
    '',
    '{"classificacao":"TESTE|LEAD|ORDEM|VALIOSO|DESCARTAVEL",',
    '"resumo":"2-3 frases do que rolou na chamada",',
    '"participantes":"quem falou (nomes se aparecerem)",',
    '"pontos_chave":["...", "..."],',
    '"decisoes":["...", "..."],',
    '"proximos_passos":["...", "..."]}',
    '',
    'Regras: TESTE = chamada só pra testar o sistema; LEAD = possível cliente/negócio novo;',
    'ORDEM = o owner pediu ações durante a chamada; VALIOSO = contexto/operacional;',
    'DESCARTÁVEL = nada aproveitável. Se não houve decisão, use [] — nunca invente.',
    '',
    meta,
    '',
    '## Transcrição (início → fim da chamada)',
    transcript.slice(0, 12_000),
  ].join('\n');

export function createCallDigestHandler(deps: CallDigestDeps): JobHandler {
  const { pool, adapter, log } = deps;

  return async function callDigest(job: JobRow): Promise<void> {
    const payload = job.payload as unknown as DigestPayload;
    if (!payload.transcript_path || !existsSync(payload.transcript_path)) {
      log.warn({ path: payload.transcript_path }, 'call.digest: transcrição não encontrada — skip');
      return;
    }
    const full = readFileSync(payload.transcript_path, 'utf8');
    // só a seção de transcrição pro classificador (o cabeçalho já vira meta)
    const transcript = full.split('## Transcrição')[1] ?? full;
    const meta = [
      `Chamada com: ${payload.destinatario ?? 'n/d'}`,
      `Objetivo: ${payload.objetivo ?? 'n/d'}`,
      `Turnos: ${payload.turnos ?? 'n/d'}`,
    ].join('\n');

    log.info({ destinatario: payload.destinatario }, 'call.digest: classificando transcrição da chamada');

    let parsed: {
      classificacao?: string;
      resumo?: string;
      participantes?: string;
      pontos_chave?: string[];
      decisoes?: string[];
      proximos_passos?: string[];
    };
    try {
      const turn = await adapter.sendTurn({
        session_key: `call.digest:${job.id}`,
        prompt: CLASSIFY_PROMPT(meta, transcript),
      });
      const candidate = turn.reply_text.match(/\{[\s\S]*\}/)?.[0] ?? turn.reply_text;
      parsed = JSON.parse(candidate) as typeof parsed;
      if (!parsed.classificacao) throw new Error('classificação vazia');
    } catch (err) {
      // falha do classificador não perde a chamada: grava bruto + escala leve
      log.error({ err: String(err).slice(0, 200) }, 'call.digest: classificador falhou — gravando digest bruto');
      await appendDigest(payload, {
        classificacao: 'NÃO CLASSIFICADO',
        resumo: 'Classificador indisponível — ver o arquivo da transcrição.',
        participantes: '', pontos_chave: [], decisoes: [], proximos_passos: [],
      });
      await publishEvent(pool, {
        event_type: 'call.digest.failed', source: 'call_digest',
        payload: { destinatario: payload.destinatario ?? null },
        idempotency_key: `calldigest:failed:${job.id}`,
      });
      return;
    }

    const cls = String(parsed.classificacao).toUpperCase();
    await appendDigest(payload, {
      classificacao: cls,
      resumo: parsed.resumo ?? '',
      participantes: parsed.participantes ?? '',
      pontos_chave: parsed.pontos_chave ?? [],
      decisoes: parsed.decisoes ?? [],
      proximos_passos: parsed.proximos_passos ?? [],
    });

    if (cls === 'LEAD' || cls === 'ORDEM' || cls === 'VALIOSO') {
      const day = new Date().toISOString().slice(0, 10);
      const line = `- ${day} · call digest (${cls}) · autor: Luna — chamada com ${payload.destinatario ?? 'n/d'}: ${(parsed.resumo ?? '').slice(0, 160)}`;
      const syn = join(BRAIN_ROOT, 'luna', 'synapses', `${day.slice(0, 7)}.md`);
      mkdirSync(dirname(syn), { recursive: true });
      writeFileSync(syn, line + '\n', { flag: 'a' });
      await recordActivity(pool, {
        kind: cls === 'LEAD' ? 'action' : 'info',
        summary: `Chamada classificada ${cls}: ${(parsed.resumo ?? '').slice(0, 180)}`,
        correlation_id: payload.correlation_id ?? null,
      });
    }

    await publishEvent(pool, {
      event_type: 'call.digest.completed', source: 'call_digest',
      payload: {
        classificacao: cls,
        destinatario: payload.destinatario ?? null,
        resumo: (parsed.resumo ?? '').slice(0, 200),
        transcript_path: payload.transcript_path,
      },
      idempotency_key: `calldigest:done:${job.id}`,
    });
    await recordAudit(pool, {
      actor: 'call_digest',
      action: 'call.digest.completed',
      tool: 'call_digest_job',
      correlation_id: payload.correlation_id ?? null,
      result: 'success',
      metadata: { classificacao: cls, destinatario: payload.destinatario ?? null },
    });
    log.info({ classificacao: cls }, 'call.digest: classificação anotada no brain');
  };

  async function appendDigest(
    payload: DigestPayload,
    d: {
      classificacao: string;
      resumo: string;
      participantes: string;
      pontos_chave: string[];
      decisoes: string[];
      proximos_passos: string[];
    },
  ): Promise<void> {
    const month = new Date().toISOString().slice(0, 7);
    const file = join(BRAIN_ROOT, 'luna', 'calls', `${month}.md`);
    mkdirSync(dirname(file), { recursive: true });
    const lines = [
      `## ${new Date().toISOString()} — ${payload.destinatario ?? 'chamada'} [${d.classificacao}]`,
      '',
      d.resumo,
      d.participantes ? `\n**Participantes:** ${d.participantes}` : '',
      d.pontos_chave.length ? `\n**Pontos-chave:** ${d.pontos_chave.map((p) => `- ${p}`).join('\n')}` : '',
      d.decisoes.length ? `\n**Decisões:** ${d.decisoes.map((p) => `- ${p}`).join('\n')}` : '',
      d.proximos_passos.length ? `\n**Próximos passos:** ${d.proximos_passos.map((p) => `- ${p}`).join('\n')}` : '',
      `\n_Transcrição completa: ${payload.transcript_path}_`,
      '',
    ].filter(Boolean);
    writeFileSync(file, lines.join('\n') + '\n', { flag: 'a' });
  }
}

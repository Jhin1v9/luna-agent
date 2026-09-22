import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { KimiLiveAdapter } from '@luna/agent';
import { recordActivity, recordAudit, readHeartbeats } from '@luna/database';
import { z } from 'zod';

/**
 * F4 mínimo — chat admin via Telegram (§25): o time pergunta, a Luna
 * responde com DADOS REAIS (pack ADMIN_FULL). Loop de getUpdates no worker.
 *
 * Segurança: só responde mensagens do TELEGRAM_CHAT_ID autorizado; sem
 * chat_id configurado o loop fica IDLE (nunca responde estranho). Sem token
 * = módulo desligado com log explícito no boot.
 */

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const updateSchema = z.object({
  update_id: z.number(),
  message: z.object({
    chat: z.object({ id: z.number() }),
    text: z.string().optional(),
    from: z.object({ first_name: z.string().optional() }).optional(),
  }),
});

export interface TelegramAdminDeps {
  pool: Pool;
  adapter: KimiLiveAdapter;
  log: Logger;
  botToken?: string;
  allowedChatId?: string;
  buildAdminPack: () => Promise<{ sections: string[] }>;
  /** Injetação pra testes. */
  fetchImpl?: FetchLike;
  replyImpl?: (chatId: string, text: string) => Promise<void>;
  pollIntervalMs?: number;
}

export function createTelegramAdmin(deps: TelegramAdminDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = `https://api.telegram.org/bot${deps.botToken}`;
  const pollMs = deps.pollIntervalMs ?? 20_000;
  let offset = 0;
  let timer: NodeJS.Timeout | null = null;
  let bootLogged = false;

  const reply = deps.replyImpl ?? (async (chatId: string, text: string) => {
    await fetchImpl(`${base}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: Number(chatId), text: text.slice(0, 3900) }),
    });
  });

  async function pollOnce(): Promise<void> {
    if (!deps.botToken) return;
    if (!deps.allowedChatId) {
      if (!bootLogged) {
        deps.log.warn('admin telegram: TELEGRAM_CHAT_ID ausente — loop IDLE (só responde chat autorizado; configure e restarte)');
        bootLogged = true;
      }
      return; // sem chat autorizado: idle explícito (fail-closed)
    }
    const res = await fetchImpl(`${base}/getUpdates?offset=${offset}&timeout=20`).catch((err) => {
      // Falha de rede/antigo silencioso: diagnóstico ao vivo 2026-09-22
      // (silêncio total do admin) — drop silencioso virou log.
      deps.log.warn({ err: String(err).slice(0, 200) }, 'admin telegram: getUpdates falhou (rede)');
      return null;
    });
    if (!res) return;
    const data = (await res.json().catch(() => null)) as { ok: boolean; result: unknown[]; description?: string } | null;
    if (!data?.ok) {
      deps.log.warn({ status: res.status, desc: data?.description ?? null }, 'admin telegram: getUpdates rejeitado');
      return;
    }
    for (const raw of data.result) {
      const parsed = updateSchema.safeParse(raw);
      if (!parsed.success) {
        deps.log.warn({ update_id: (raw as { update_id?: number }).update_id }, 'admin telegram: update fora do schema (ignorado)');
        continue;
      }
      const u = parsed.data;
      offset = Math.max(offset, u.update_id + 1);
      if (String(u.message.chat.id) !== deps.allowedChatId) {
        deps.log.info({ chat: u.message.chat.id, esperado: deps.allowedChatId }, 'admin telegram: update de chat não autorizado (ignorado)');
        continue;
      }
      const text = (u.message.text ?? '').trim();
      if (!text) continue;

      deps.log.info({ from: u.message.from?.first_name ?? '?', text: text.slice(0, 80) }, 'admin telegram: pergunta recebida');

      const correlation = `corr_admin_${Date.now()}`;
      const pack = await deps.buildAdminPack();
      const prompt = [
        'Você é a Luna no CHAT ADMIN (§25): o time pergunta, você responde com os dados reais abaixo.',
        'Direta, técnica, parceira de time. Nada de placeholders: se o dado não está abaixo, diz que não tem.',
        ...pack.sections,
        '',
        `Pergunta do time (${u.message.from?.first_name ?? '?'}): ${text}`,
      ].join('\n');

      const started = Date.now();
      const turn = await deps.adapter.sendTurn({ session_key: 'admin:telegram', prompt });
      await reply(String(u.message.chat.id), turn.reply_text);

      await recordAudit(deps.pool, {
        actor: 'admin-telegram',
        action: 'admin.question.answered',
        tool: 'kimi_adapter',
        correlation_id: correlation,
        duration_ms: Date.now() - started,
        result: 'success',
        metadata: { question: text.slice(0, 120), model: turn.model ?? null },
      }).catch(() => {});
      await recordActivity(deps.pool, {
        kind: 'action',
        summary: `Chat admin: respondi "${text.slice(0, 60)}" com dados reais (ADMIN_FULL).`,
        correlation_id: correlation,
      }).catch(() => {});
      deps.log.info({ question: text.slice(0, 80) }, 'admin telegram: respondido (§25)');
    }
  }

  async function restoreOffset(): Promise<void> {
    // evita reprocessar updates antigos após restart: offset fica em memória
    // por processo; em restart, getUpdates sem offset velho devolve só os
    // não confirmados — aceitável em dev (idempotência por conteúdo não vale
    // o custo; mensagens admin são perguntas novas).
    const hb = await readHeartbeats(deps.pool).catch(() => [] as never[] as Awaited<ReturnType<typeof readHeartbeats>>);
    void hb;
  }

  return {
    /** Expuesto para testes: executa um ciclo de poll. */
    pollOnce,
    async start(): Promise<void> {
      if (!deps.botToken) {
        deps.log.warn('admin telegram: TELEGRAM_BOT_TOKEN ausente — módulo desligado');
        return;
      }
      await restoreOffset();
      timer = setInterval(() => {
        pollOnce().catch((err) => deps.log.error({ err }, 'admin telegram: poll falhou'));
      }, pollMs);
      timer.unref();
      deps.log.info({ chat: deps.allowedChatId ?? 'AGUARDANDO_CHAT_ID' }, 'admin telegram: loop ativo (F4 mínimo)');
    },
    stop(): void {
      if (timer) clearInterval(timer);
    },
  };
}

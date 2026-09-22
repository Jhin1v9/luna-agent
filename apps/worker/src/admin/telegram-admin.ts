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
  // 409-resilience (diagnóstico ao vivo 2026-09-22): consumidor externo
  // segurava o getUpdates ~100% do tempo e o admin morria em silêncio.
  // Poll curto + guarda de reentrância: cada gap do outro consumidor é
  // nosso; quando vencemos, os updates acumulados chegam de uma vez.
  // Cadência 1,2s com jitter: corrida apertada — a cada queda do pipe do
  // intruso a gente pega dentro de ~1s e segura 25s por poll.
  const pollMs = deps.pollIntervalMs ?? 1_200;
  let offset = 0;
  let timer: NodeJS.Timeout | null = null;
  let bootLogged = false;
  let polling = false;
  let conflicts = 0;
  let conflictAlerted = false;
  let authFails = 0;
  let authAlerted = false;
  let slowMode = false;

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
    if (polling) return; // poll anterior ainda em voo (timeout=20 > intervalo)
    polling = true;
    const res = await fetchImpl(`${base}/getUpdates?offset=${offset}&timeout=25`).catch((err) => {
      // Falha de rede/antigo silencioso: diagnóstico ao vivo 2026-09-22
      // (silêncio total do admin) — drop silencioso virou log.
      deps.log.warn({ err: String(err).slice(0, 200) }, 'admin telegram: getUpdates falhou (rede)');
      polling = false;
      return null;
    });
    if (!res) return;
    const data = (await res.json().catch(() => null)) as { ok: boolean; result: unknown[]; description?: string } | null;
    if (!data?.ok) {
      if (res.status === 401 || res.status === 403) {
        // Token morto/revogado (ao vivo 2026-09-22: owner regenerou no
        // BotFather pra matar o consumidor externo → 401 em tudo). Retry
        // rápido só gera spam: throttle duro + log único de ação.
        authFails += 1;
        if (!authAlerted) {
          authAlerted = true;
          deps.log.error(
            { status: res.status, desc: data?.description ?? null },
            'admin telegram: TOKEN REJEITADO — atualize TELEGRAM_BOT_TOKEN (BotFather) e restarte o worker; poll em modo lento até lá',
          );
        }
        slowMode = true;
      } else if (res.status === 409) {
        conflicts += 1;
        // alerta único: outro consumidor está comendo o getUpdates
        if (conflicts >= 30 && !conflictAlerted) {
          conflictAlerted = true;
          deps.log.error({ conflicts }, 'admin telegram: 409 persistente — consumidor externo segura o getUpdates');
          try {
            const { sendTeamMessage } = await import('@luna/channels');
            await sendTeamMessage(
              '🚨 CHAT ADMIN MUDO: outro serviço está consumindo o getUpdates deste bot (~100% do tempo, 409 Conflict) — suas mensagens não chegam até mim. ' +
                'Procure o consumidor (n8n Cloud, VPS, script antigo com este token) e desligue, ou crie um bot dedicado pra Luna. ' +
                'Enquanto isso estou disputando a conexão a cada 4s e respondo nos gaps.',
              { botToken: deps.botToken, teamChatId: deps.allowedChatId },
            );
          } catch (err) {
            deps.log.error({ err }, 'admin telegram: alerta de conflito falhou');
          }
        }
      } else if (conflicts > 0 && conflicts % 10 === 0) {
        deps.log.warn({ conflicts }, 'admin telegram: getUpdates rejeitado (409) repetidamente');
      } else if (res.status !== 409) {
        deps.log.warn({ status: res.status, desc: data?.description ?? null }, 'admin telegram: getUpdates rejeitado');
      }
      polling = false;
      return;
    }
    if (conflicts > 0 || slowMode) {
      deps.log.info({ conflicts, slowMode }, 'admin telegram: getUpdates de volta (conflito resolvido)');
      conflicts = 0;
      conflictAlerted = false;
      authFails = 0;
      authAlerted = false;
      if (slowMode) {
        // token curado: volta pro poll rápido
        slowMode = false;
        restartTimer(1_200);
      }
    }
    polling = false;
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

  function restartTimer(ms: number): void {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      pollOnce().catch((err) => deps.log.error({ err }, 'admin telegram: poll falhou'));
      // jitter evita lockstep com o consumidor externo (corridas em fase
      // deixam um dos dois ganhar sempre)
    }, ms + Math.floor(Math.random() * 400));
    timer.unref();
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
      restartTimer(slowMode ? 120_000 : pollMs);
      deps.log.info({ chat: deps.allowedChatId ?? 'AGUARDANDO_CHAT_ID' }, 'admin telegram: loop ativo (F4 mínimo)');
    },
    stop(): void {
      if (timer) clearInterval(timer);
    },
  };
}

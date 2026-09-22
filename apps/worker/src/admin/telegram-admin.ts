import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { KimiLiveAdapter } from '@luna/agent';
import { recordActivity, recordAudit, readHeartbeats } from '@luna/database';
import { classifyAdminMessage } from './orders.js';
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
    from: z.object({ id: z.number().optional(), first_name: z.string().optional() }).optional(),
  }),
});

export interface TelegramAdminDeps {
  pool: Pool;
  adapter: KimiLiveAdapter;
  log: Logger;
  botToken?: string;
  allowedChatId?: string;
  /** P3 (ADR-035): whitelist de user_ids do Telegram que podem dar ORDENS.
   *  Vazia = qualquer membro do chat autorizado pode (log warn no boot). */
  allowedUserIds?: string[];
  /** P3: live brain (KimiCliAdapter) que executa ordens. */
  live?: KimiLiveAdapter;
  /** P3: exige confirmação inline para ordens destrutivas. Default true. */
  confirmDestructive?: boolean;
  /** P3: timeout de parede por ordem. Default 5 min. */
  orderTimeoutMs?: number;
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
  // segurava o getUpdates ~100% do tempo e o admin mordia em silêncio.
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
  /** P3: confirmação inline pendente por chat (ordem destrutiva). */
  const pendingConfirm = new Map<string, { order: string; adminName: string; expiresAt: number }>();
  let whitelistWarned = false;

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
      const fromId = u.message.from?.id != null ? String(u.message.from.id) : null;
      const adminName = u.message.from?.first_name ?? '?';

      // P3 (ADR-035): whitelist de admins por user_id. Vazia = qualquer
      // membro do chat autorizado (warn uma vez no boot — owner configura
      // ADMIN_TELEGRAM_IDS pra fechar).
      if (deps.allowedUserIds && deps.allowedUserIds.length > 0) {
        if (!fromId || !deps.allowedUserIds.includes(fromId)) {
          deps.log.warn({ from: fromId }, 'admin telegram: user FORA da whitelist — ordem recusada (fail-closed)');
          await reply(String(u.message.chat.id), `⛔ Você (${fromId ?? 'sem id'}) não está na whitelist de admins.`);
          await recordAudit(deps.pool, {
            actor: 'admin-telegram',
            action: 'admin.order.refused',
            tool: 'telegram_admin',
            correlation_id: `corr_admin_${Date.now()}`,
            result: 'failed',
            metadata: { reason: 'user_not_whitelisted', from_id: fromId, text: text.slice(0, 120) },
          }).catch(() => {});
          continue;
        }
      } else if (!whitelistWarned) {
        whitelistWarned = true;
        deps.log.warn('admin telegram: ADMIN_TELEGRAM_IDS vazia — qualquer membro do chat autorizado pode dar ordens');
      }

      deps.log.info({ from: adminName, text: text.slice(0, 80) }, 'admin telegram: pergunta recebida');

      // ── P3: máquina de confirmação inline (ordem destrutiva pendente) ──
      const chatKey = String(u.message.chat.id);
      const pending = pendingConfirm.get(chatKey);
      if (pending) {
        pendingConfirm.delete(chatKey);
        if (Date.now() > pending.expiresAt) {
          await reply(chatKey, '⌛ A confirmação expirou (5 min) — manda a ordem de novo se ainda quiser.');
          continue;
        }
        if (/^(sim|confirma|confirmo|pode|ok|yes|y|pode ir|manda)$/i.test(text)) {
          deps.log.warn({ order: pending.order }, 'admin telegram: ordem destrutiva CONFIRMADA — executando');
          await executeOrder(chatKey, pending.order, pending.adminName, fromId);
        } else {
          await reply(chatKey, '🚫 Cancelado. Nada foi executado.');
        }
        continue;
      }

      // ── P3: classificar pergunta vs ordem ──
      const classification = classifyAdminMessage(text);
      if (classification.kind === 'order' && deps.live) {
        if (classification.destructive && deps.confirmDestructive !== false) {
          pendingConfirm.set(chatKey, { order: text, adminName, expiresAt: Date.now() + 5 * 60_000 });
          deps.log.warn({ order: text.slice(0, 100), from: fromId }, 'admin telegram: ordem DESTRUTIVA — aguardando confirmação inline');
          await reply(
            chatKey,
            `⚠️ Isso parece DESTRUTIVO/irreversível:\n"${text.slice(0, 200)}"\n\nConfirma? Responda "sim" em até 5 min (qualquer outra coisa cancela).`,
          );
          continue;
        }
        await executeOrder(chatKey, text, adminName, fromId);
        continue;
      }

      // PERGUNTA (fluxo F4 existente): FAST responde com dados reais.
      const correlation = `corr_admin_${Date.now()}`;
      const pack = await deps.buildAdminPack();
      const prompt = [
        'Você é a Luna no CHAT ADMIN (§25): o time pergunta, você responde com os dados reais abaixo.',
        'Direta, técnica, parceira de time. Nada de placeholders: se o dado não está abaixo, diz que não tem.',
        ...pack.sections,
        '',
        `Pergunta do time (${adminName}): ${text}`,
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

  /** P3: executa uma ordem no live brain e responde com evidência. */
  async function executeOrder(chatId: string, order: string, adminName: string, fromId: string | null): Promise<void> {
    const correlation = `corr_admin_order_${Date.now()}`;
    const started = Date.now();
    try {
      const { runAdminOrder } = await import('./orders.js');
      const { text } = await runAdminOrder(
        {
          live: deps.live!,
          timeoutMs: deps.orderTimeoutMs ?? 300_000,
          confirmDestructive: deps.confirmDestructive ?? true,
        },
        { order, adminName, sessionKey: `admin:user:${fromId ?? 'unknown'}` },
      );
      await reply(chatId, text.slice(0, 3900));
      await recordAudit(deps.pool, {
        actor: 'admin-telegram',
        action: 'admin.order.executed',
        tool: 'kimi_cli',
        correlation_id: correlation,
        duration_ms: Date.now() - started,
        result: 'success',
        metadata: { order: order.slice(0, 200), from_id: fromId },
      }).catch(() => {});
      await recordActivity(deps.pool, {
        kind: 'action',
        summary: `Chat admin: ordem executada — "${order.slice(0, 60)}"`,
        correlation_id: correlation,
      }).catch(() => {});
      deps.log.info({ order: order.slice(0, 80) }, 'admin telegram: ordem executada');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await reply(chatId, `❌ Falhei ao executar: ${msg.slice(0, 500)}`);
      await recordAudit(deps.pool, {
        actor: 'admin-telegram',
        action: 'admin.order.executed',
        tool: 'kimi_cli',
        correlation_id: correlation,
        duration_ms: Date.now() - started,
        result: 'failed',
        metadata: { order: order.slice(0, 200), from_id: fromId, error: msg.slice(0, 300) },
      }).catch(() => {});
      deps.log.error({ err: msg }, 'admin telegram: ordem falhou');
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

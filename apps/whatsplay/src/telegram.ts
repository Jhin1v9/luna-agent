/**
 * Telegram fallback vivo (§15): WhatsPlay detecta sessão caída → mensagem VIVA
 * ao grupo do time com contexto e urgência reais. Bot API, grátis, sem polling.
 * Token só via env (pino redige). fetch injetável para testes.
 */

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface TelegramConfig {
  botToken?: string;
  teamChatId?: string;
}

export class TelegramNotConfigured extends Error {
  constructor() {
    super('Telegram fallback desligado: TELEGRAM_BOT_TOKEN/TELEGRAM_TEAM_CHAT_ID ausentes.');
    this.name = 'TelegramNotConfigured';
  }
}

export async function sendTeamMessage(
  text: string,
  config: TelegramConfig,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: boolean; messageId?: number }> {
  if (!config.botToken || !config.teamChatId) throw new TelegramNotConfigured();
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: config.teamChatId, text }),
  });
  if (!res.ok) {
    throw new Error(`Telegram HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { ok: boolean; result?: { message_id?: number } };
  return { ok: data.ok, messageId: data.result?.message_id };
}

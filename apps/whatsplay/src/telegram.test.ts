import { describe, it, expect } from 'vitest';
import { sendTeamMessage, TelegramNotConfigured } from './telegram.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const CONFIG = { botToken: 'bot-token', teamChatId: '-100123' };

describe('Telegram fallback vivo (§15)', () => {
  it('envia msg ao time via Bot API', async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return jsonResponse({ ok: true, result: { message_id: 42 } });
    };
    const r = await sendTeamMessage('WhatsApp caiu — Luna segura as respostas.', CONFIG, fetchImpl);
    expect(r).toEqual({ ok: true, messageId: 42 });
    expect(seen!.url).toBe('https://api.telegram.org/botbot-token/sendMessage');
    const body = JSON.parse(String(seen!.init?.body)) as { chat_id: string; text: string };
    expect(body.chat_id).toBe('-100123');
    expect(body.text).toContain('WhatsApp caiu');
  });

  it('sem token/chat id: falha explícita (fallback desligado, nunca silencioso)', async () => {
    await expect(sendTeamMessage('x', {}, async () => jsonResponse({}))).rejects.toThrow(
      TelegramNotConfigured,
    );
  });

  it('HTTP 4xx/5xx do Telegram vira erro com detalhe', async () => {
    await expect(
      sendTeamMessage('x', CONFIG, async () => jsonResponse({ description: 'chat not found' }, 400)),
    ).rejects.toThrow(/400/);
  });
});

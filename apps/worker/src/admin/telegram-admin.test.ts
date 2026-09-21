import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { createTelegramAdmin } from './telegram-admin.js';

const log = pino({ level: 'silent' });

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function makeDeps(chatId: number, text: string, over: Record<string, unknown> = {}) {
  const replies: Array<{ chat: string; text: string }> = [];
  let adapterCalls = 0;
  const fetchImpl = async (url: string) => {
    if (url.includes('getUpdates')) {
      return jsonResponse({
        ok: true,
        result: [{ update_id: 10, message: { chat: { id: chatId }, text, from: { first_name: 'Abner' } } }],
      });
    }
    return jsonResponse({ ok: true });
  };
  const adapter = {
    mode: 'kimi-api' as const,
    async ensureSession(k: string) {
      return { session_id: k, busy: false };
    },
    async sendTurn(req: { prompt: string }) {
      adapterCalls++;
      expect(req.prompt).toContain('CHAT ADMIN');
      return { reply_text: 'Resposta com dados reais.', session_id: 'x', duration_ms: 1, model: 'kimi-k2.6' };
    },
    async readMessages() {
      return [];
    },
  };
  const admin = createTelegramAdmin({
    pool: {
      async query() {
        return { rowCount: 0, rows: [] };
      },
    } as never,
    adapter: adapter as never,
    log,
    botToken: 'tok',
    allowedChatId: '12345',
    buildAdminPack: async () => ({ sections: ['- orchestrator: ok'] }),
    fetchImpl: fetchImpl as never,
    replyImpl: async (c: string, t: string) => {
      replies.push({ chat: c, text: t });
    },
    ...over,
  });
  return { admin, replies, adapterCalls: () => adapterCalls };
}

describe('chat admin via Telegram (§25, F4 mínimo)', () => {
  it('mensagem do chat AUTORIZADO → adapter chamado + resposta enviada', async () => {
    const { admin, replies, adapterCalls } = makeDeps(12345, 'como está o sistema?');
    await admin.pollOnce();
    expect(adapterCalls()).toBe(1);
    expect(replies).toEqual([{ chat: '12345', text: 'Resposta com dados reais.' }]);
  });

  it('mensagem de OUTRO chat → ignorada (zero chamadas de IA, zero resposta)', async () => {
    const { admin, replies, adapterCalls } = makeDeps(999, 'sou estranho');
    await admin.pollOnce();
    expect(adapterCalls()).toBe(0);
    expect(replies).toEqual([]);
  });

  it('sem chat_id autorizado → idle: poll não chama getUpdates nem IA', async () => {
    const { admin, replies, adapterCalls } = makeDeps(12345, 'oi', { allowedChatId: undefined });
    await admin.pollOnce();
    expect(adapterCalls()).toBe(0);
    expect(replies).toEqual([]);
  });
});

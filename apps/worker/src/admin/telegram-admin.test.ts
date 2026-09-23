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
      // P4: 1ª chamada = roteador (prompt sem 'CHAT ADMIN' → resposta
      // malformada de propósito → cai no regex → 2ª chamada no fluxo F4).
      if (req.prompt.includes('CHAT ADMIN')) {
        return { reply_text: 'Resposta com dados reais.', session_id: 'x', duration_ms: 1, model: 'kimi-k2.6' };
      }
      return { reply_text: 'RESPOSTA-MALFORMADA', session_id: 'x', duration_ms: 1 };
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
  it('mensagem do chat AUTORIZADO → roteador + FAST respondem, resposta enviada', async () => {
    const { admin, replies, adapterCalls } = makeDeps(12345, 'como está o sistema?');
    await admin.pollOnce();
    expect(adapterCalls()).toBe(2); // 1 roteamento (P4) + 1 resposta (F4, regex fallback)
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

describe('P3 — canal admin: whitelist + ordens no live brain (ADR-035)', () => {
  function makeQueueDeps(updates: Array<{ text: string; fromId?: number; firstName?: string }>, over: Record<string, unknown> = {}) {
    const replies: Array<{ chat: string; text: string }> = [];
    let uid = 100;
    const fastCalls: string[] = [];
    const liveCalls: Array<{ session_key: string; prompt: string }> = [];
    const audits: Array<{ action: string; result: string }> = [];
    const fetchImpl = async (url: string) => {
      if (url.includes('getUpdates')) {
        const u = updates.shift();
        if (!u) return jsonResponse({ ok: true, result: [] });
        return jsonResponse({
          ok: true,
          result: [
            {
              update_id: uid++,
              message: {
                chat: { id: 12345 },
                text: u.text,
                from: { id: u.fromId ?? 777, first_name: u.firstName ?? 'Abner' },
              },
            },
          ],
        });
      }
      return jsonResponse({ ok: true });
    };
    const admin = createTelegramAdmin({
      pool: {
        async query(sql: string) {
          if (sql.includes('INSERT INTO audit_log')) audits.push({ action: String(arguments[1]?.[1] ?? ''), result: 'x' });
          return { rowCount: 0, rows: [] };
        },
      } as never,
      adapter: {
        mode: 'kimi-api' as const,
        async ensureSession(k: string) {
          return { session_id: k, busy: false };
        },
        async sendTurn(req: { prompt: string }) {
          fastCalls.push(req.prompt);
          return { reply_text: 'RESPOSTA-FAST', session_id: 'x', duration_ms: 1 };
        },
        async readMessages() {
          return [];
        },
      } as never,
      live: {
        mode: 'kimi-cli' as const,
        async ensureSession(k: string) {
          return { session_id: k, busy: false };
        },
        async sendTurn(req: { session_key: string; prompt: string }) {
          liveCalls.push(req);
          return { reply_text: 'ORDEM-EXECUTADA: pm2 list ok', session_id: 'x', duration_ms: 1 };
        },
        async readMessages() {
          return [];
        },
      } as never,
      log,
      botToken: 'tok',
      allowedChatId: '12345',
      confirmDestructive: true,
      buildAdminPack: async () => ({ sections: ['- pack'] }),
      fetchImpl: fetchImpl as never,
      replyImpl: async (c: string, t: string) => {
        replies.push({ chat: c, text: t });
      },
      ...over,
    });
    return { admin, replies, fastCalls, liveCalls, audits };
  }

  it('ordem NÃO-destrutiva → FAST roteia (resposta malformada → regex), live brain executa com evidência', async () => {
    const { admin, replies, fastCalls, liveCalls } = makeQueueDeps([{ text: 'Lista os serviços pm2' }]);
    await admin.pollOnce();
    expect(fastCalls).toHaveLength(1); // chamada de roteamento (P4)
    expect(liveCalls).toHaveLength(1);
    expect(liveCalls[0]!.prompt).toContain('Lista os serviços pm2');
    expect(replies[0]!.text).toBe('ORDEM-EXECUTADA: pm2 list ok');
  });

  it('ordem DESTRUTIVA → pede confirmação inline; "sim" executa; outra coisa cancela', async () => {
    const a = makeQueueDeps([{ text: 'Reinicia o PC' }, { text: 'sim' }]);
    await a.admin.pollOnce();
    expect(a.liveCalls).toHaveLength(0); // ainda não executou
    expect(a.replies[0]!.text).toContain('Confirma?');
    await a.admin.pollOnce();
    expect(a.liveCalls).toHaveLength(1);
    expect(a.replies[1]!.text).toBe('ORDEM-EXECUTADA: pm2 list ok');

    const b = makeQueueDeps([{ text: 'Desliga o servidor' }, { text: 'deixa pra lá' }]);
    await b.admin.pollOnce();
    await b.admin.pollOnce();
    expect(b.liveCalls).toHaveLength(0);
    expect(b.replies[1]!.text).toContain('Cancelado');
  });

  it('whitelist: user FORA da lista → ordem recusada com fail-closed (zero execução)', async () => {
    const { admin, replies, liveCalls } = makeQueueDeps(
      [{ text: 'Lista os serviços pm2', fromId: 555 }],
      { allowedUserIds: ['777'] },
    );
    await admin.pollOnce();
    expect(liveCalls).toHaveLength(0);
    expect(replies[0]!.text).toContain('whitelist');
  });

  it('whitelist: user NA lista → ordem executa', async () => {
    const { admin, liveCalls } = makeQueueDeps(
      [{ text: 'Lista os serviços pm2', fromId: 777 }],
      { allowedUserIds: ['777'] },
    );
    await admin.pollOnce();
    expect(liveCalls).toHaveLength(1);
  });

  it('pergunta (?) continua indo pro FAST com o pack admin — live brain não é chamado', async () => {
    const { admin, fastCalls, liveCalls } = makeQueueDeps([{ text: 'Qual o status do worker?' }]);
    await admin.pollOnce();
    // 1 chamada de roteamento (P4) + 1 resposta F4 (regex fallback — mock
    // devolve texto malformado de propósito).
    expect(fastCalls).toHaveLength(2);
    expect(liveCalls).toHaveLength(0);
  });

  it('sem live brain configurado → ordem cai no fluxo de pergunta (degradação segura)', async () => {
    const { admin, fastCalls, replies } = makeQueueDeps([{ text: 'Lista os serviços pm2' }], { live: undefined });
    await admin.pollOnce();
    // roteamento (malformado → regex vê ORDEM) + resposta F4 com o pack.
    expect(fastCalls).toHaveLength(2);
    expect(replies[0]!.text).toBe('RESPOSTA-FAST');
  });
});

describe('P4 — roteamento por LLM (delegate.ts): decisão + prompt composto num turno só', () => {
  function makeRouterDeps(updates: Array<{ text: string }>, over: Record<string, unknown> = {}) {
    const replies: Array<{ chat: string; text: string }> = [];
    let uid = 200;
    const fastCalls: string[] = [];
    const liveCalls: Array<{ session_key: string; prompt: string }> = [];
    const fetchImpl = async (url: string) => {
      if (url.includes('getUpdates')) {
        const u = updates.shift();
        if (!u) return jsonResponse({ ok: true, result: [] });
        return jsonResponse({
          ok: true,
          result: [{ update_id: uid++, message: { chat: { id: 12345 }, text: u.text, from: { id: 777, first_name: 'Abner' } } }],
        });
      }
      return jsonResponse({ ok: true });
    };
    const admin = createTelegramAdmin({
      pool: {
        async query() {
          return { rowCount: 0, rows: [] };
        },
      } as never,
      adapter: {
        mode: 'kimi-api' as const,
        async ensureSession(k: string) {
          return { session_id: k, busy: false };
        },
        // Roteador content-aware: decide pelo texto do admin no prompt.
        async sendTurn(req: { prompt: string }) {
          fastCalls.push(req.prompt);
          if (req.prompt.includes('Lista os processos')) {
            return {
              reply_text: 'DECISAO: ORDEM\nCONTEUDO: Rode `pm2 list` no diretório do projeto e resuma os processos ativos com uptime.',
              session_id: 'x',
              duration_ms: 1,
            };
          }
          return {
            reply_text: 'DECISAO: RESPONDER\nCONTEUDO: Tudo operando normalmente, uptime 99%.',
            session_id: 'x',
            duration_ms: 1,
          };
        },
        async readMessages() {
          return [];
        },
      } as never,
      live: {
        mode: 'kimi-cli' as const,
        async ensureSession(k: string) {
          return { session_id: k, busy: false };
        },
        async sendTurn(req: { session_key: string; prompt: string }) {
          liveCalls.push(req);
          return { reply_text: 'ORDEM-EXECUTADA: pm2 list ok', session_id: 'x', duration_ms: 1 };
        },
        async readMessages() {
          return [];
        },
      } as never,
      log,
      botToken: 'tok',
      allowedChatId: '12345',
      confirmDestructive: true,
      buildAdminPack: async () => ({ sections: ['- pack'] }),
      fetchImpl: fetchImpl as never,
      replyImpl: async (c: string, t: string) => {
        replies.push({ chat: c, text: t });
      },
      ...over,
    });
    return { admin, replies, fastCalls, liveCalls };
  }

  it('ORDEM decidida pelo LLM → live brain executa com o PROMPT COMPOSTO + regras duras anexadas', async () => {
    const { admin, replies, fastCalls, liveCalls } = makeRouterDeps([{ text: 'Lista os processos do pm2' }]);
    await admin.pollOnce();
    expect(fastCalls).toHaveLength(1); // só o turno do roteador — sem 2ª chamada
    expect(liveCalls).toHaveLength(1);
    expect(liveCalls[0]!.prompt).toContain('Rode `pm2 list`'); // prompt otimizado pelo FAST
    expect(liveCalls[0]!.prompt).toContain('PROJETO DE CLIENTE É VEDADO'); // footer de regras duras
    expect(replies[0]!.text).toBe('ORDEM-EXECUTADA: pm2 list ok');
  });

  it('RESPONDER decidida pelo LLM → resposta direta no mesmo turno, zero live brain', async () => {
    const { admin, replies, fastCalls, liveCalls } = makeRouterDeps([{ text: 'como está o sistema?' }]);
    await admin.pollOnce();
    expect(fastCalls).toHaveLength(1);
    expect(liveCalls).toHaveLength(0);
    expect(replies).toEqual([{ chat: '12345', text: 'Tudo operando normalmente, uptime 99%.' }]);
  });
});

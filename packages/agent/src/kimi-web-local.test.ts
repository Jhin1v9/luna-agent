import { describe, expect, it } from 'vitest';
import { KimiWebLocalAdapter } from './kimi-web-local.js';

/**
 * KimiWebLocalAdapter — regressão do bug de ordenação (2026-09-26).
 *
 * A API /messages devolve a página NEWEST-FIRST (primeiro item = mensagem
 * mais recente). O poll antigo fazia `slice(startIdx + 1)` — que numa lista
 * newest-first pega só mensagens MAIS VELHAS que o prompt — e devolvia a
 * resposta mais antiga da sessão com texto ("Limpando os temporários..."
 * em vez do ping real). Estes testes fixam o contrato: a resposta devolvida
 * é a do ASSISTENTE MAIS NOVO após o prompt, nunca uma resposta velha.
 */

interface FakeMsg {
  id: string;
  role: string;
  created_at: string;
  content?: Array<{ type: string; text?: string }>;
}

function fakeFetch(opts: {
  sessionMessages: FakeMsg[]; // newest-first, como a API real
  busySequence: boolean[]; // respostas do GET session em sequência
}) {
  let busyIdx = 0;
  const calls: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.endsWith('/prompts') && init?.method === 'POST') {
      return new Response(JSON.stringify({ code: 0, data: { user_message_id: 'msg_user_1' } }), { status: 200 });
    }
    if (url.endsWith('/messages')) {
      return new Response(JSON.stringify({ code: 0, data: { items: opts.sessionMessages, has_more: false } }), { status: 200 });
    }
    // GET session
    const busy = opts.busySequence[Math.min(busyIdx++, opts.busySequence.length - 1)]!;
    return new Response(JSON.stringify({ code: 0, data: { busy } }), { status: 200 });
  };
  return { fetchImpl, calls };
}

const adapter = (fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) =>
  new KimiWebLocalAdapter({
    baseUrl: 'http://127.0.0.1:58629',
    token: 't',
    sessionId: 's1',
    pollMs: 1,
    fetchImpl: fetchImpl as never,
  });

describe('KimiWebLocalAdapter — ordenação newest-first da API de mensagens', () => {
  it('devolve a resposta NOVA do turno, não a resposta MAIS ANTIGA com texto', async () => {
    const OLD_ASSISTANT: FakeMsg = {
      id: 'msg_old',
      role: 'assistant',
      created_at: '2026-09-26T11:49:00Z',
      content: [{ type: 'text', text: 'Limpando os temporários e fechando:' }],
    };
    const PROMPT: FakeMsg = {
      id: 'msg_user_1',
      role: 'user',
      created_at: '2026-09-26T20:49:13Z',
      content: [{ type: 'text', text: 'TESTE PING: responder apenas ping-7711' }],
    };
    // página newest-first ANTES da resposta chegar
    const before = [PROMPT, OLD_ASSISTANT];
    // página newest-first DEPOIS da resposta chegar
    const REPLY: FakeMsg = {
      id: 'msg_reply',
      role: 'assistant',
      created_at: '2026-09-26T20:49:16Z',
      content: [{ type: 'text', text: 'ping-7711' }],
    };
    const pages: FakeMsg[][] = [before, [REPLY, ...before]];
    let pageIdx = 0;
    const { fetchImpl } = fakeFetch({ sessionMessages: [], busySequence: [true, false] });
    const paging = async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.endsWith('/messages') && !init?.method) {
        const page = pages[Math.min(pageIdx++, pages.length - 1)]!;
        return new Response(JSON.stringify({ code: 0, data: { items: page, has_more: false } }), { status: 200 });
      }
      return fetchImpl(url, init);
    };
    const turn = await adapter(paging).sendTurn({ session_key: 'k', prompt: 'TESTE PING: responder apenas ping-7711' });
    expect(turn.reply_text).toBe('ping-7711');
  });

  it('não devolve nada enquanto o prompt não aparece na página (evita resposta velha)', async () => {
    const STALE: FakeMsg = {
      id: 'msg_stale',
      role: 'assistant',
      created_at: '2026-09-26T10:00:00Z',
      content: [{ type: 'text', text: 'resposta velha qualquer' }],
    };
    // sessão ociosa, prompt nunca aparece → deve estourar "resposta vazia"
    // (busy false), nunca devolver a resposta velha
    const { fetchImpl } = fakeFetch({ sessionMessages: [STALE], busySequence: [false] });
    await expect(adapter(fetchImpl).sendTurn({ session_key: 'k', prompt: 'prompt que nunca chega' })).rejects.toThrow(
      /resposta vazia/,
    );
  });
});

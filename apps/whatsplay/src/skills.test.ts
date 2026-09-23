import { describe, expect, it } from 'vitest';
import { createWhatsAppSkills, type ContactRef } from './skills.js';
import type { ChatSearchResult, WhatsAppTransport } from './transport.js';

interface Mock {
  transport: WhatsAppTransport & { searchInChat: NonNullable<WhatsAppTransport['searchInChat']> };
  calls: string[];
  lastSend: { target: string; text: string } | null;
}

function makeMock(searchResult: ChatSearchResult = { found: true, resultCount: 3 }): Mock {
  const calls: string[] = [];
  const state: { lastSend: Mock['lastSend'] } = { lastSend: null };
  const transport = {
    async getStatus() {
      calls.push('getStatus');
      return { state: 'LOGGED_IN', pageAlive: true, lastHeartbeatAt: new Date(), outgoingQueued: 0 } as never;
    },
    async getUnread() {
      calls.push('getUnread');
      return [];
    },
    async readConversation(chatId: string) {
      calls.push(`readConversation:${chatId}`);
      return [];
    },
    async sendMessage(chatId: string, text: string) {
      calls.push(`sendMessage:${chatId}`);
      state.lastSend = { target: chatId, text };
      return `sent:${chatId}`;
    },
    async searchInChat(chatId: string, query: string) {
      calls.push(`searchInChat:${chatId}:${query}`);
      return searchResult;
    },
  };
  return {
    transport: transport as never,
    calls,
    get lastSend() {
      return state.lastSend;
    },
    set lastSend(v) {
      state.lastSend = v;
    },
  };
}

describe('skill layer (PLANO-SKILLS.md §2)', () => {
  it('mention.detect reconhece @luna (case-insensitive, substring)', () => {
    const s = createWhatsAppSkills({ transport: makeMock().transport });
    expect(s['mention.detect']('@luna oi')).toBe(true);
    expect(s['mention.detect']('ei @LUNA!')).toBe(true);
    expect(s['mention.detect']('olá pessoal')).toBe(false);
  });

  it('chat.send resolve alvo pelo ContactMap (número mapeado = determinístico)', async () => {
    const m = makeMock();
    const map: Record<string, ContactRef> = { Superclim: { name: 'Superclim', phone: '+34 600 00 00 00' } };
    const s = createWhatsAppSkills({ transport: m.transport, resolveContact: async (n) => map[n] ?? null });
    await s['chat.send']('Superclim', 'oi');
    expect(m.lastSend?.target).toBe('+34 600 00 00 00');
  });

  it('chat.send sem mapeamento cai no nome (comportamento atual)', async () => {
    const m = makeMock();
    const s = createWhatsAppSkills({ transport: m.transport });
    await s['chat.send']('Fernanda 😎', 'oi');
    expect(m.lastSend?.target).toBe('Fernanda 😎');
  });

  it('chat.search (lupa) delega pro transport com alvo resolvido', async () => {
    const m = makeMock({ found: true, resultCount: 5 });
    const s = createWhatsAppSkills({ transport: m.transport });
    const r = await s['chat.search']('🏆Production - 2026🙏🏻', 'reunião sábado');
    expect(r).toEqual({ found: true, resultCount: 5 });
    expect(m.calls).toContain('searchInChat:🏆Production - 2026🙏🏻:reunião sábado');
  });

  it('mention.respond: lupa confirma a mensagem + resposta citando o autor', async () => {
    const m = makeMock({ found: true, resultCount: 1 });
    const s = createWhatsAppSkills({ transport: m.transport });
    const r = await s['mention.respond']({
      conversation: '🏆Production - 2026🙏🏻',
      text: 'anotado, vou registrar a reunião!',
      mentionQuery: 'temos uma tarefa nova',
      author: 'Superclim',
    });
    expect(r.mentionFound).toBe(true);
    expect(m.lastSend?.text).toBe('Superclim, anotado, vou registrar a reunião!');
    expect(m.lastSend?.target).toBe('🏆Production - 2026🙏🏻');
  });

  it('mention.respond: lupa falha NÃO aborta a resposta (mentionFound=null)', async () => {
    const m = makeMock();
    m.transport.searchInChat = async () => {
      throw new Error('lupa quebrou (UI fora do esperado)');
    };
    const s = createWhatsAppSkills({ transport: m.transport });
    const r = await s['mention.respond']({
      conversation: '🏆Production - 2026🙏🏻',
      text: 'oi!',
      mentionQuery: 'qualquer',
      author: null,
    });
    expect(r.mentionFound).toBeNull();
    expect(m.lastSend?.text).toBe('oi!');
  });

  it('mention.respond: mensagem NÃO achada na lupa ainda responde (found=false auditável)', async () => {
    const m = makeMock({ found: false, resultCount: 0 });
    const s = createWhatsAppSkills({ transport: m.transport });
    const r = await s['mention.respond']({
      conversation: 'grupo',
      text: 'vendo aqui…',
      mentionQuery: 'texto que não existe',
    });
    expect(r.mentionFound).toBe(false);
    expect(m.lastSend).not.toBeNull();
  });

  it('contact.find resolve pelo mapa; sem mapa → null', async () => {
    const m = makeMock();
    const withMap = createWhatsAppSkills({
      transport: m.transport,
      resolveContact: async (n) => (n === 'Pai' ? { name: 'Pai', phone: '+34 697 64 81 13' } : null),
    });
    expect(await withMap['contact.find']('Pai')).toEqual({ name: 'Pai', phone: '+34 697 64 81 13' });
    expect(await withMap['contact.find']('desconhecido')).toBeNull();
    const noMap = createWhatsAppSkills({ transport: m.transport });
    expect(await noMap['contact.find']('Pai')).toBeNull();
  });
});

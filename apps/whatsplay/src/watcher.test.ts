import { describe, it, expect } from 'vitest';
import { diffBadges, IngestWatcher, type ChatBadge } from './watcher.js';

const chat = (id: string, unread: number, preview: string): ChatBadge => ({
  chat_id: id,
  chat_name: id,
  unread,
  preview,
  is_group: false,
});

describe('diffBadges — novidade só quando o preview muda (seed anti-disparo)', () => {
  it('mapa vazio (watcher ainda não fez seed): tudo é novidade — por isso o tick SEMPRE arma o baseline antes de difar', () => {
    const prev = new Map<string, string>();
    const curr = [chat('a', 5, 'oi'), chat('b', 168, 'figurinha')];
    expect(diffBadges(prev, curr)).toHaveLength(2);
  });

  it('seed armado + conversa NOVA com badge: DISPARA (mensagem de cliente novo)', () => {
    const prev = new Map([['a', 'oi']]);
    const curr = [chat('a', 5, 'oi'), chat('novo', 1, 'cheguei')];
    expect(diffBadges(prev, curr)).toHaveLength(1);
  });

  it('preview igual ao baseline: silêncio (msg antiga, sem novidade)', () => {
    const prev = new Map([['a', 'oi'], ['b', 'figurinha']]);
    const curr = [chat('a', 5, 'oi'), chat('b', 168, 'figurinha')];
    expect(diffBadges(prev, curr)).toEqual([]);
  });

  it('preview mudou com badge: dispara (mensagem nova)', () => {
    const prev = new Map([['a', 'oi']]);
    const curr = [chat('a', 2, 'oi tudo bem?')];
    expect(diffBadges(prev, curr)).toHaveLength(1);
  });

  it('badge zerou: não dispara mesmo com preview novo', () => {
    const prev = new Map([['a', 'oi']]);
    const curr = [{ ...chat('a', 0, 'oi tudo bem?') }];
    expect(diffBadges(prev, curr)).toEqual([]);
  });

});

describe('ESCOPO DE INGESTÃO — allowlist fail-closed (decreto do owner, ADR-020)', () => {
  function makeWatcher(allowlist: string[], enforce: boolean) {
    const readCalls: string[] = [];
    const ingested: string[] = [];
    let sample = 0;
    const page = {
      evaluate: async () =>
        sample++ === 0
          ? [{ chat_id: 'c1', chat_name: 'Pai', unread: 2, preview: 'oi', is_group: false }]
          : [
              { chat_id: 'c1', chat_name: 'Pai', unread: 3, preview: 'oi pai', is_group: false },
              { chat_id: 'c2', chat_name: 'Fora Do Escopo', unread: 1, preview: 'novo', is_group: false },
            ],
    };
    const transport = {
      readConversation: async (chatId: string) => {
        readCalls.push(chatId);
        return [{ sender: 'x', direction: 'inbound' as const, text: 'texto de ' + chatId }];
      },
    };
    const watcher = new IngestWatcher(
      {
        pool: {} as never,
        transport: transport as never,
        log: { info: () => {}, debug: () => {}, error: () => {} } as never,
        page,
        selectors: {},
        debounceMs: 5,
        ingestAllowlist: allowlist,
        enforceIngestAllowlist: enforce,
        ingestFn: async (msg) => {
          ingested.push(msg.chat_id);
          return 'published';
        },
      },
      { intervalMs: 60_000 },
    );
    return { watcher, readCalls, ingested };
  }

  it('chat FORA do escopo: NÃO abre o chat (zero mark-as-read), NÃO ingere, NÃO gasta tokens', async () => {
    const { watcher, readCalls, ingested } = makeWatcher(['Pai'], true);
    await watcher.tick(); // seed
    await watcher.tick(); // diff
    await new Promise((r) => setTimeout(r, 30)); // debounce flush
    expect(readCalls).toEqual(['c1']); // só o Pai foi aberto
    expect(ingested).toEqual(['c1']); // fora do escopo ignorado
  });

  it('lista VAZIA em dev: NADA é processado (fail-closed)', async () => {
    const { watcher, readCalls, ingested } = makeWatcher([], true);
    await watcher.tick();
    await watcher.tick();
    await new Promise((r) => setTimeout(r, 30));
    expect(readCalls).toEqual([]);
    expect(ingested).toEqual([]);
  });

  it('grupo permitido por nome (decreto owner): entra no escopo', async () => {
    const { watcher, readCalls, ingested } = makeWatcher(['🏆Production - 2026🙏🏻'], true);
    // reconfigura amostra: c1 vira o grupo permitido
    (watcher as unknown as { deps: { page: { evaluate: () => Promise<unknown> } } }).deps.page.evaluate = (async () =>
      [{ chat_id: 'g1', chat_name: '🏆Production - 2026🙏🏻', unread: 1, preview: '@luna oi', is_group: true }]) as never;
    await watcher.tick(); // seed
    await watcher.tick(); // mesmo preview → sem diff
    expect(ingested).toEqual([]);
    (watcher as unknown as { deps: { page: { evaluate: () => Promise<unknown> } } }).deps.page.evaluate = (async () =>
      [{ chat_id: 'g1', chat_name: '🏆Production - 2026🙏🏻', unread: 2, preview: '@luna oi tudo', is_group: true }]) as never;
    await watcher.tick();
    await new Promise((r) => setTimeout(r, 30));
    expect(readCalls).toEqual(['g1']);
    expect(ingested).toEqual(['g1']);
  });

  it('produção (enforce=false): tudo processado normalmente', async () => {
    const { watcher, readCalls, ingested } = makeWatcher(['Pai'], false);
    await watcher.tick();
    await watcher.tick();
    await new Promise((r) => setTimeout(r, 30));
    expect(readCalls).toContain('c2');
    expect(ingested).toContain('c2');
  });
});

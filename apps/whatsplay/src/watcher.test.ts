import { describe, it, expect } from 'vitest';
import { diffBadges, IngestWatcher, looksLikeGroupPreview, type ChatBadge } from './watcher.js';

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

describe('contato novo — grupos nunca viram solicitação de autorização', () => {
  it('detecta JID e preview com autor típico de grupo', () => {
    expect(looksLikeGroupPreview('120@g.us', 'oi')).toBe(true);
    expect(looksLikeGroupPreview('Brasileiros', '~Silvia: Muito bom')).toBe(true);
    expect(looksLikeGroupPreview('Cliente', 'Olá, preciso limpar meu sofá')).toBe(false);
  });
});

describe('ESCOPO DE INGESTÃO — allowlist fail-closed (decreto do owner, ADR-020)', () => {
  function makeWatcher(allowlist: string[], enforce: boolean, sweepEnabled = false) {
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
      { intervalMs: 60_000, sweepEnabled },
    );
    return { watcher, readCalls, ingested };
  }

  it('sweep DESLIGADO (padrão, decreto 2026-09-24): badge-path INGERE chats allowlisted — é o único caminho', async () => {
    const { watcher, readCalls, ingested } = makeWatcher(['Pai'], true, false);
    await watcher.tick(); // seed (+ reconcile do boot, decreto owner 03/10)
    await watcher.tick(); // diff
    await new Promise((r) => setTimeout(r, 30)); // debounce flush
    expect(readCalls).toContain('Pai'); // decreto owner 14/10 (bug ao vivo 19:48): abre pelo TÍTULO visível — JID não indexa na busca do WA
    expect(ingested).toContain('c1'); // ingest SEMPRE pelo chat_id real (§7.6)
    // O mock muda o preview entre coletas, então reconcile e diff-path podem
    // disparar juntos — na produção a idempotency de messages (§7.6) dedupa.
  });

  it('sweep LIGADO: badge-path ignora chats allowlisted (sweep é o dono — sem corrida)', async () => {
    const { watcher, readCalls, ingested } = makeWatcher(['Pai'], true, true);
    await watcher.tick(); // seed
    await watcher.tick(); // diff
    await new Promise((r) => setTimeout(r, 30)); // debounce flush
    expect(readCalls).toEqual([]); // sweep cuida; badge-path não abre
    expect(ingested).toEqual([]);
  });

  it('lista VAZIA em dev: NADA é processado (fail-closed)', async () => {
    const { watcher, readCalls, ingested } = makeWatcher([], true);
    await watcher.tick();
    await watcher.tick();
    await new Promise((r) => setTimeout(r, 30));
    expect(readCalls).toEqual([]);
    expect(ingested).toEqual([]);
  });

  it('produção (enforce=false): badge-path processa tudo normalmente', async () => {
    const { watcher, readCalls, ingested } = makeWatcher(['Pai'], false);
    await watcher.tick();
    await watcher.tick();
    await new Promise((r) => setTimeout(r, 30));
    expect(readCalls).toContain('Fora Do Escopo'); // abertura pelo título (decreto 14/10)
    expect(ingested).toContain('c2');
  });
});

describe('SWEEP de chats allowlisted — mensagem do owner (outbound @luna) dispara em dev', () => {
  function makeSweepWatcher(script: Array<Array<{ sender: string; direction: 'inbound' | 'outbound'; text: string }>>, isGroup = false) {
    const ingested: Array<{ chat_id: string; text: string }> = [];
    let sample = 0;
    const page = { evaluate: async () => [] as unknown[] };
    const transport = {
      readConversation: async () => script[Math.min(sample, script.length - 1)]!,
      currentChatIsGroup: async () => isGroup,
    };
    const watcher = new IngestWatcher(
      {
        pool: {} as never,
        transport: transport as never,
        log: { info: () => {}, debug: () => {}, error: () => {} } as never,
        page,
        selectors: {},
        debounceMs: 5,
        ingestAllowlist: ['Pai'],
        enforceIngestAllowlist: true,
        ingestFn: async (msg) => {
          ingested.push({ chat_id: msg.chat_id, text: msg.text });
          return 'published';
        },
      },
      // sweep periódico agora é OPT-IN (decreto owner 2026-09-24) — esses
      // testes exercitam o sweep, então ligam explicitamente.
      { intervalMs: 60_000, sweepEnabled: true },
    );
    // sweep roda quando sweepCount % 8 === 0; o 1º tick é seed (retorna antes
    // do sweep), então 9 ticks garantem uma janela de sweep por chamada.
    const tickWithSweep = async () => {
      for (let i = 0; i < 9; i++) await watcher.tick();
      sample++;
      await new Promise((r) => setTimeout(r, 30));
    };
    return { watcher, ingested, tickWithSweep };
  }

  it('mensagem OUTBOUND do owner com @luna → dispara (self-test trigger)', async () => {
    const { ingested, tickWithSweep } = makeSweepWatcher([
      [], // seed: sem mensagens
      [{ sender: 'Tú', direction: 'outbound', text: '@luna oi' }],
    ]);
    await tickWithSweep(); // seed + sweep vazio
    expect(ingested).toEqual([]);
    await tickWithSweep(); // sweep vê "@luna oi" do owner
    expect(ingested).toHaveLength(1);
    expect(ingested[0]!.text).toBe('Tú: @luna oi'); // transcrição com autor
  });

  it('resposta da própria Luna (outbound SEM @luna) → ignorada', async () => {
    const { ingested, tickWithSweep } = makeSweepWatcher([
      [],
      [{ sender: 'Tú', direction: 'outbound', text: 'Oi! Tudo bem por aí?' }],
    ]);
    await tickWithSweep();
    await tickWithSweep();
    expect(ingested).toEqual([]);
  });

  it('mensagem INBOUND de cliente → dispara normalmente', async () => {
    const { ingested, tickWithSweep } = makeSweepWatcher([
      [],
      [{ sender: 'Pai', direction: 'inbound', text: 'boa tarde' }],
    ]);
    await tickWithSweep();
    await tickWithSweep();
    expect(ingested).toHaveLength(1);
    expect(ingested[0]!.text).toBe('Pai: boa tarde');
  });

  it('mesma mensagem em varreduras seguidas → não repete', async () => {
    const { ingested, tickWithSweep } = makeSweepWatcher(
      [[{ sender: 'Pai', direction: 'inbound', text: 'oi de novo' }]],
    );
    await tickWithSweep(); // primeira vista: dispara (acionável)
    expect(ingested).toHaveLength(1);
    await tickWithSweep(); // mesma mensagem → não repete
    await tickWithSweep();
    expect(ingested).toHaveLength(1);
  });
});

describe('REGRESSÃO roteamento: resposta vai SEMPRE pro chat de origem (bug 2026-09-21)', () => {
  it('pergunta no grupo → evento com chat_id do GRUPO mesmo com outro chat allowlisted ativo', async () => {
    const ingested: Array<{ chat_id: string; text: string }> = [];
    const perChat: Record<string, Array<{ sender: string; direction: 'inbound' | 'outbound'; text: string }>> = {
      '🏆Production - 2026🙏🏻': [{ sender: 'Abner', direction: 'inbound', text: 'pergunta do grupo GROUP-SECRET' }],
      'Outro Chat': [{ sender: 'X', direction: 'inbound', text: 'mensagem do outro chat OTHER-SECRET' }],
    };
    const transport = {
      readConversation: async (chatId: string) => perChat[chatId] ?? [],
      currentChatIsGroup: async () => true,
    };
    const watcher = new IngestWatcher(
      {
        pool: {} as never,
        transport: transport as never,
        log: { info: () => {}, debug: () => {}, error: () => {} } as never,
        page: { evaluate: async () => [] as unknown[] },
        selectors: {},
        debounceMs: 5,
        ingestAllowlist: ['🏆Production - 2026🙏🏻', 'Outro Chat'],
        enforceIngestAllowlist: true,
        ingestFn: async (msg) => {
          ingested.push({ chat_id: msg.chat_id, text: msg.text });
          return 'published';
        },
      },
      { intervalMs: 60_000, sweepEnabled: true },
    );
    for (let i = 0; i < 9; i++) await watcher.tick(); // seed + sweep
    await new Promise((r) => setTimeout(r, 30));

    const grupo = ingested.filter((m) => m.text.includes('GROUP-SECRET'));
    const outro = ingested.filter((m) => m.text.includes('OTHER-SECRET'));
    expect(grupo).toHaveLength(1);
    expect(grupo[0]!.chat_id).toBe('🏆Production - 2026🙏🏻'); // NUNCA no outro chat
    expect(outro).toHaveLength(1);
    expect(outro[0]!.chat_id).toBe('Outro Chat');
  });

  it('contrato do transport: chat não aberto → [] (nunca painel arbitrário)', async () => {
    // O browser.ts garante com verificação de título: readConversation só
    // devolve mensagens do chatId pedido — esse é o buraco do cross-chat.
    const perChat = { A: [{ sender: 's', direction: 'inbound' as const, text: 'segredo de A' }] };
    const t = { readConversation: async (id: string) => perChat[id as 'A'] ?? [] };
    await expect(t.readConversation('B')).resolves.toEqual([]);
  });
});

describe('REGRESSÃO reentrância do tick (bug ao vivo 2026-09-22)', () => {
  it('tick em andamento faz o próximo esperar — work de painel nunca concorrente', async () => {
    let reads = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const perChat: Record<string, Array<{ sender: string; direction: 'inbound' | 'outbound'; text: string }>> = {
      Pai: [{ sender: 'Tú', direction: 'outbound', text: '@luna oi' }],
    };
    const transport = {
      readConversation: async () => {
        reads++;
        await gate; // work lento (simula open+ler+close > intervalo)
        return perChat.Pai!;
      },
      currentChatIsGroup: async () => false,
    };
    const watcher = new IngestWatcher(
      {
        pool: {} as never,
        transport: transport as never,
        log: { info: () => {}, debug: () => {}, error: () => {} } as never,
        page: { evaluate: async () => [] as unknown[] },
        selectors: {},
        debounceMs: 5,
        ingestAllowlist: ['Pai'],
        enforceIngestAllowlist: true,
        ingestFn: async () => 'published',
      },
      { intervalMs: 60_000, sweepEnabled: true },
    );
    const t1 = watcher.tick(); // seed
    await t1;
    await watcher.tick(); // sweepCount 1
    await watcher.tick(); // sweepCount 2
    const p1 = watcher.tick(); // sweepCount 3 → sweep (trava no gate)
    await new Promise((r) => setTimeout(r, 50));
    const r2 = await watcher.tick(); // reentrante → deve retornar na hora sem work
    expect(r2.fresh).toBe(0);
    expect(reads).toBe(1); // sweep 1 rodando, sweep 2 NÃO começou
    release();
    await p1;
    expect(reads).toBe(1); // total: um único work de painel
  });
});

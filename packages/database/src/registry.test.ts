import { describe, expect, it } from 'vitest';
import { registryLookup, registryCheck, registryUpsert } from './registry.js';
import type { Sql } from './audit.js';

function dbWith(rows: Array<Record<string, unknown>>): Sql {
  return {
    async query() {
      return { rowCount: rows.length, rows } as never;
    },
  } as Sql;
}

const PAI = {
  chat_key: '34672953062',
  kind: 'individual',
  canonical_name: 'Pai',
  display_hint: 'Pai',
  role: 'allowed',
  notify_channel: 'whatsapp:+34672953062',
  phone_e164: '+34 672 95 30 62',
} as const;

const NAMORADA = {
  chat_key: 'blocked:meu-amorzinho',
  kind: 'individual',
  canonical_name: 'Meu Amorzinho',
  display_hint: 'Meu Amorzinho 💖🌻',
  role: 'blocked',
  notify_channel: null,
  phone_e164: null,
} as const;

describe('Chat Registry (migração 012, deny-first)', () => {
  it('resolve por nome canônico, display hint e variações ("meu pai" → Pai)', async () => {
    const db = dbWith([PAI]);
    expect((await registryLookup(db, 'Pai'))?.chatKey).toBe('34672953062');
    expect((await registryLookup(db, 'meu pai'))?.chatKey).toBe('34672953062');
    expect((await registryLookup(db, 'PAI'))?.chatKey).toBe('34672953062');
  });

  it('normaliza acentos e emoji no display hint', async () => {
    const db = dbWith([{ ...PAI, display_hint: 'Produção 🙏🏻', canonical_name: 'Produção 2026' }]);
    expect((await registryLookup(db, 'producao'))?.canonicalName).toBe('Produção 2026');
  });

  it('allowed → ok com a entrada inteira (chat_key = identidade)', async () => {
    const d = await registryCheck(dbWith([PAI]), 'Pai', 'ligar');
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.entry.chatKey).toBe('34672953062');
      expect(d.entry.notifyChannel).toBe('whatsapp:+34672953062');
    }
  });

  it('blocked → recusa SEMPRE, mesmo se também estivesse numa allowlist', async () => {
    const d = await registryCheck(dbWith([NAMORADA]), 'Meu Amorzinho 💖🌻', 'ligar');
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toMatch(/BLOCKED/);
  });

  it('fora do registry → fail-closed: recusa e pede registro ao owner', async () => {
    const d = await registryCheck(dbWith([PAI]), 'Jess', 'mandar mensagem');
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.reason).toMatch(/NÃO está no Chat Registry/);
      expect(d.reason).toMatch(/mandar mensagem/);
    }
  });

  it('upsert insere e atualiza (ON CONFLICT por chat_key+kind)', async () => {
    const executed: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      async query(sql: string, params?: unknown[]) {
        executed.push({ sql, params: params ?? [] });
        return { rowCount: 1, rows: [] } as never;
      },
    } as Sql;
    await registryUpsert(db, {
      chatKey: PAI.chat_key,
      kind: PAI.kind,
      canonicalName: PAI.canonical_name,
      displayHint: PAI.display_hint,
      role: PAI.role,
      notifyChannel: PAI.notify_channel,
      phoneE164: PAI.phone_e164,
    });
    expect(executed[0]!.sql).toContain('INSERT INTO chat_registry');
    await registryUpsert(db, {
      chatKey: NAMORADA.chat_key,
      kind: NAMORADA.kind,
      canonicalName: NAMORADA.canonical_name,
      displayHint: NAMORADA.display_hint,
      role: NAMORADA.role,
      notifyChannel: null,
      phoneE164: null,
      note: 'incidente 2026-09-23',
    });
    const params = executed[1]!.params;
    expect(params[4]).toBe('blocked');
    expect(params[8]).toBe('incidente 2026-09-23');
  });
});

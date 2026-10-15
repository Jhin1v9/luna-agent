import { describe, expect, it, afterEach } from 'vitest';
import { createVoiceCallTool } from './tools-voice-call.js';
import { PERSONA_SUMMARY } from '../context.js';

const REGISTRY_ROWS = [
  {
    chat_key: '34672953062',
    kind: 'individual',
    canonical_name: 'Pai',
    display_hint: 'Pai',
    role: 'allowed',
    notify_channel: 'whatsapp:+34672953062',
    phone_e164: '+34 672 95 30 62',
  },
  {
    chat_key: 'blocked:meu-amorzinho',
    kind: 'individual',
    canonical_name: 'Meu Amorzinho',
    display_hint: 'Meu Amorzinho 💖🌻',
    role: 'blocked',
    notify_channel: null,
    phone_e164: null,
  },
];

const fakeDb = (registryRows: unknown[] = REGISTRY_ROWS) => {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const db = {
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      if (sql.startsWith('INSERT INTO jobs')) return { rowCount: 1, rows: [{ id: 'job-1' }] };
      if (sql.includes('FROM chat_registry')) return { rowCount: registryRows.length, rows: registryRows };
      return { rowCount: 0, rows: [] };
    },
  };
  return { db, queries };
};

afterEach(() => {
  delete process.env.VOICE_CALL_ENABLED;
});

describe('voice.call_place (contenção P0 + Chat Registry)', () => {
  it('persona/system prompt informa a capacidade e o estado de manutenção', () => {
    expect(PERSONA_SUMMARY).toContain('CAPACIDADE DE VOZ');
    expect(PERSONA_SUMMARY).toContain('voice.call_place');
    expect(PERSONA_SUMMARY).toContain('DESLIGADA');
    expect(PERSONA_SUMMARY).toContain('silêncio vale ouro');
  });

  it('DESLIGADO por padrão → recusa explícita, zero enfileiramento', async () => {
    const { db, queries } = fakeDb();
    const tool = createVoiceCallTool(db as never);
    const r = await tool(db as never, { conversationId: 'c', clientId: null }, { contato: 'Pai' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('DESLIGADO');
    expect(queries.filter((q) => q.sql.startsWith('INSERT INTO jobs'))).toHaveLength(0);
  });

  it('HABILITADO + alvo resolvido no registry → enfileira com chat_key no brief', async () => {
    process.env.VOICE_CALL_ENABLED = 'true';
    const { db, queries } = fakeDb();
    const tool = createVoiceCallTool(db as never);
    const r = await tool(db as never, { conversationId: 'conv-1', clientId: null }, { contato: 'meu pai', motivo: 'cliente pediu humano', objetivo: 'falar com o Pai' });
    expect(r.ok).toBe(true);
    const insert = queries.find((q) => q.sql.startsWith('INSERT INTO jobs'));
    expect(insert).toBeDefined();
    expect(insert!.params![0]).toBe('voice.call');
    const payload = JSON.stringify(insert!.params![1]);
    expect(payload).toContain('Pai');
    expect(payload).toContain('34672953062'); // identidade, não nome solto
    expect((r.data as { destino: { chat_key: string } }).destino.chat_key).toBe('34672953062');
  });

  it('HABILITADO + alvo BLOCKED no registry → recusa (a namorada nunca mais)', async () => {
    process.env.VOICE_CALL_ENABLED = 'true';
    const { db, queries } = fakeDb();
    const tool = createVoiceCallTool(db as never);
    const r = await tool(db as never, { conversationId: 'c', clientId: null }, { contato: 'Meu Amorzinho 💖🌻' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/BLOCKED/);
    expect(queries.filter((q) => q.sql.startsWith('INSERT INTO jobs'))).toHaveLength(0);
  });

  it('HABILITADO + fora do registry → fail-closed (recusa + pede registro)', async () => {
    process.env.VOICE_CALL_ENABLED = 'true';
    const { db, queries } = fakeDb();
    const tool = createVoiceCallTool(db as never);
    const r = await tool(db as never, { conversationId: 'c', clientId: null }, { contato: 'Jess' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cadastro \(chat_registry\)/);
    expect(queries.filter((q) => q.sql.startsWith('INSERT INTO jobs'))).toHaveLength(0);
  });

  it('HABILITADO + sem contato → falha explícita (nunca enfileira chamada vazia)', async () => {
    process.env.VOICE_CALL_ENABLED = 'true';
    const { db } = fakeDb();
    const tool = createVoiceCallTool(db as never);
    const r = await tool(db as never, { conversationId: 'c', clientId: null }, {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain('contato');
  });
});

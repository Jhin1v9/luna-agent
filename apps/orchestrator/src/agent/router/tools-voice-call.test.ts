import { describe, expect, it, afterEach } from 'vitest';
import { createVoiceCallTool } from './tools-voice-call.js';
import { PERSONA_SUMMARY } from '../context.js';

const fakeDb = () => {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const db = {
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      if (sql.startsWith('INSERT INTO jobs')) return { rowCount: 1, rows: [{ id: 'job-1' }] };
      return { rowCount: 0, rows: [] };
    },
  };
  return { db, queries };
};

afterEach(() => {
  delete process.env.VOICE_CALL_ENABLED;
  delete process.env.WHATSAPP_OUTBOUND_ALLOWLIST;
});

describe('voice.call_place (contenção P0 pós-incidente 2026-09-23)', () => {
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

  it('HABILITADO + alvo na allowlist → enfileira o job voice.call com o brief', async () => {
    process.env.VOICE_CALL_ENABLED = 'true';
    process.env.WHATSAPP_OUTBOUND_ALLOWLIST = 'Pai,🏆Production - 2026🙏🏻';
    const { db, queries } = fakeDb();
    const tool = createVoiceCallTool(db as never);
    const r = await tool(db as never, { conversationId: 'conv-1', clientId: null }, { contato: 'Pai', motivo: 'cliente pediu humano', objetivo: 'falar com o Pai' });
    expect(r.ok).toBe(true);
    const insert = queries.find((q) => q.sql.startsWith('INSERT INTO jobs'));
    expect(insert).toBeDefined();
    expect(insert!.params![0]).toBe('voice.call');
    expect(JSON.stringify(insert!.params![1])).toContain('Pai');
    expect((r.data as { enfileirado: boolean }).enfileirado).toBe(true);
  });

  it('HABILITADO + alvo FORA da allowlist → recusa (a namorada nunca mais)', async () => {
    process.env.VOICE_CALL_ENABLED = 'true';
    process.env.WHATSAPP_OUTBOUND_ALLOWLIST = 'Pai';
    const { db, queries } = fakeDb();
    const tool = createVoiceCallTool(db as never);
    const r = await tool(db as never, { conversationId: 'c', clientId: null }, { contato: 'Meu Amorzinho 💖🌻' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('fora da outbound allowlist');
    expect(queries.filter((q) => q.sql.startsWith('INSERT INTO jobs'))).toHaveLength(0);
  });

  it('HABILITADO + sem contato → falha explícita (nunca enfileira chamada vazia)', async () => {
    process.env.VOICE_CALL_ENABLED = 'true';
    const db = { async query() { return { rowCount: 0, rows: [] }; } };
    const tool = createVoiceCallTool(db as never);
    const r = await tool(db as never, { conversationId: 'c', clientId: null }, {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain('contato');
  });
});

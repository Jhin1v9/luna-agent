import { describe, expect, it } from 'vitest';
import { createVoiceCallTool } from './tools-voice-call.js';
import { PERSONA_SUMMARY } from '../context.js';

describe('voice.call_place (decreto owner: a FAST Luna sabe que pode ligar)', () => {
  it('persona/system prompt contém a capacidade de fazer ligações + quando usar', () => {
    expect(PERSONA_SUMMARY).toContain('CAPACIDADE DE VOZ');
    expect(PERSONA_SUMMARY).toContain('voice.call_place');
    expect(PERSONA_SUMMARY).toContain('QUANDO USAR');
    expect(PERSONA_SUMMARY).toContain('silêncio vale ouro');
  });

  it('tool enfileira o job voice.call com o brief e devolve o que vai acontecer', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const db = {
      async query(sql: string, params?: unknown[]) {
        queries.push({ sql, params });
        if (sql.startsWith('INSERT INTO jobs')) return { rowCount: 1, rows: [{ id: 'job-1' }] };
        return { rowCount: 0, rows: [] };
      },
    };
    const tool = createVoiceCallTool(db as never);
    const r = await tool(db as never, { conversationId: 'conv-1', clientId: null }, { contato: 'Pai', motivo: 'cliente pediu humano', objetivo: 'falar com o Pai' });
    expect(r.ok).toBe(true);
    const insert = queries.find((q) => q.sql.startsWith('INSERT INTO jobs'));
    expect(insert).toBeDefined();
    expect(insert!.params![0]).toBe('voice.call');
    expect(JSON.stringify(insert!.params![1])).toContain('Pai');
    expect((r.data as { enfileirado: boolean }).enfileirado).toBe(true);
  });

  it('sem contato → falha explícita (nunca enfileira chamada vazia)', async () => {
    const db = { async query() { return { rowCount: 0, rows: [] }; } };
    const tool = createVoiceCallTool(db as never);
    const r = await tool(db as never, { conversationId: 'c', clientId: null }, {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain('contato');
  });
});

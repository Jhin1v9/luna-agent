import { describe, expect, it } from 'vitest';
import { KimiWorkAdapter, type PoolLike } from './kimiwork.js';
import { KimiAdapterError } from './types.js';

/**
 * Fake pool programável: respostas por trecho de SQL na ordem em que
 * aparecem (ou por matcher). Cobre INSERT ... RETURNING, SELECT de poll e
 * UPDATE de timeout.
 */
function fakePool(handler: (sql: string, params: unknown[]) => { rows: unknown[] }): PoolLike & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    query: async (sql: string, params: unknown[] = []) => {
      calls.push(sql);
      return handler(sql, params);
    },
  };
}

const TURN = { session_key: 'conv-1', prompt: 'persona+contexto+oi' };

describe('KimiWorkAdapter', () => {
  it('sendTurn retorna a resposta quando o turno é respondido', async () => {
    let polls = 0;
    const pool = fakePool((sql) => {
      if (sql.includes('INSERT')) return { rows: [{ id: 'turn-1' }] };
      if (sql.includes('UPDATE')) return { rows: [] };
      polls += 1;
      // primeira poll: ainda pending; segunda: answered
      return { rows: [polls === 1 ? { status: 'pending', response: null, error: null } : { status: 'answered', response: 'olá, sou a Luna', error: null }] };
    });
    const adapter = new KimiWorkAdapter({ mode: 'kimiwork' }, { pool, sleep: async () => {} });
    const res = await adapter.sendTurn(TURN);
    expect(res.reply_text).toBe('olá, sou a Luna');
    expect(res.provider).toBe('kimiwork');
    expect(res.session_id).toBe('conv-1');
    expect(res.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('sendTurn propaga failed gravado pelo Kimi Work', async () => {
    const pool = fakePool((sql) => {
      if (sql.includes('INSERT')) return { rows: [{ id: 'turn-2' }] };
      return { rows: [{ status: 'failed', response: null, error: 'sem contexto' }] };
    });
    const adapter = new KimiWorkAdapter({ mode: 'kimiwork' }, { pool, sleep: async () => {} });
    await expect(adapter.sendTurn(TURN)).rejects.toThrow(KimiAdapterError);
    await expect(adapter.sendTurn(TURN)).rejects.toThrow(/sem contexto/);
  });

  it('timeout marca failed e lança erro explícito (sem mock)', async () => {
    let updates = 0;
    const pool = fakePool((sql) => {
      if (sql.includes('INSERT')) return { rows: [{ id: 'turn-3' }] };
      if (sql.includes('UPDATE')) {
        updates += 1;
        return { rows: [] };
      }
      return { rows: [{ status: 'pending', response: null, error: null }] };
    });
    let t = 0;
    const progress: Array<{ turnId: string; elapsedMs: number; polls: number }> = [];
    const adapter = new KimiWorkAdapter(
      { mode: 'kimiwork' },
      {
        pool,
        timeoutMs: 100,
        pollIntervalMs: 25,
        progressIntervalMs: 50,
        onProgress: (info) => progress.push(info),
        sleep: async () => {},
        now: () => (t += 50),
      },
    );
    // Decreto Jhino 2026-09-24: sem "timeout de operação" — o cap (aqui 100ms
    // injetado) é só segurança anti-lock eterno, com progresso avisando.
    await expect(adapter.sendTurn(TURN)).rejects.toThrow(/cap de segurança/);
    expect(updates).toBe(1);
    expect(progress.length).toBeGreaterThan(0); // avisou de pouco em pouco
  });

  it('INSERT com idempotency duplicada reusa o turno existente', async () => {
    const pool = fakePool((sql) => {
      if (sql.includes('INSERT')) return { rows: [] }; // conflito: DO NOTHING não retorna linha
      if (sql.includes('SELECT id FROM')) return { rows: [{ id: 'turn-dup' }] };
      return { rows: [{ status: 'answered', response: 'resposta do turno duplicado', error: null }] };
    });
    const adapter = new KimiWorkAdapter({ mode: 'kimiwork' }, { pool, sleep: async () => {} });
    const res = await adapter.sendTurn(TURN);
    expect(res.reply_text).toBe('resposta do turno duplicado');
  });

  it('ensureSession é virtual (chave estável) e readMessages vazio', async () => {
    const pool = fakePool(() => ({ rows: [] }));
    const adapter = new KimiWorkAdapter({ mode: 'kimiwork' }, { pool });
    await expect(adapter.ensureSession('conv-x')).resolves.toEqual({ session_id: 'conv-x', busy: false });
    await expect(adapter.readMessages('conv-x')).resolves.toEqual([]);
  });

  it('roteador de chat (decreto owner 2026-09-24): session_key de voz grava channel=voice, demais channel=geral', async () => {
    const channels: unknown[] = [];
    const pool = fakePool((sql, params) => {
      if (sql.includes('INSERT')) {
        channels.push(params[4]); // 5º param = channel
        return { rows: [{ id: 'turn-ch' }] };
      }
      return { rows: [{ status: 'answered', response: 'ok', error: null }] };
    });
    const adapter = new KimiWorkAdapter({ mode: 'kimiwork' }, { pool, sleep: async () => {} });
    await adapter.sendTurn({ session_key: 'conductor:corr_1', prompt: 'x' });
    await adapter.sendTurn({ session_key: 'operator:prompt:Pai', prompt: 'x' });
    await adapter.sendTurn({ session_key: 'repair:chat-1', prompt: 'x' });
    expect(channels).toEqual(['voice', 'voice', 'geral']);
  });
});

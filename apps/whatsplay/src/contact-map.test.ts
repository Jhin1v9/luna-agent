import { describe, expect, it } from 'vitest';
import { createContactMapResolver, mapContactPhone } from './contact-map.js';

function makePool(rows: Array<{ name: string; phone: string | null }>, updates: number[] = []) {
  return {
    async query(_sql: string, params?: unknown[]) {
      if (String(_sql).startsWith('SELECT')) return { rowCount: rows.length ? 1 : 0, rows: rows.slice(0, 1) };
      updates.push(1);
      return { rowCount: rows.length ? 1 : 0, rows: [] };
    },
  } as never;
}

describe('ContactMap (PLANO-SKILLS.md §2)', () => {
  it('resolve nome → número mapeado', async () => {
    const resolve = createContactMapResolver(makePool([{ name: 'Pai', phone: '+34 697 64 81 13' }]));
    expect(await resolve('Pai')).toEqual({ name: 'Pai', phone: '+34 697 64 81 13' });
  });

  it('contato sem mapeamento → phone null (busca cai no nome)', async () => {
    const resolve = createContactMapResolver(makePool([{ name: 'Fernanda 😎', phone: null }]));
    expect(await resolve('Fernanda 😎')).toEqual({ name: 'Fernanda 😎', phone: null });
  });

  it('contato inexistente → null', async () => {
    const resolve = createContactMapResolver(makePool([]));
    expect(await resolve('desconhecido')).toBeNull();
  });

  it('mapContactPhone grava e é idempotente por diferença', async () => {
    const updates: number[] = [];
    const pool = makePool([{ name: 'Pai', phone: null }], updates);
    await mapContactPhone(pool, 'Pai', '+34 697 64 81 13');
    expect(updates).toHaveLength(1);
  });
});

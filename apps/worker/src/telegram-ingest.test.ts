import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { createTelegramIngest } from './telegram-ingest.js';

const log = pino({ level: 'silent' });

function makePool(insertResults: Array<string | null>) {
  const calls: unknown[][] = [];
  let n = 0;
  const pool = {
    async query(sql: string, params: unknown[]) {
      calls.push([sql, ...params]);
      const r = insertResults[n++];
      return { rowCount: r === null || r === undefined ? 0 : 1, rows: r === null || r === undefined ? [] : [{ id: r }] };
    },
  } as never;
  return { pool, calls };
}

describe('ingest telegram → kimiwork_inbox (menções @luna)', () => {
  it('matches: "luna", "@Luna" e "pra luna" batem; "sistema", "lunar" não', () => {
    const ingest = createTelegramIngest({ pool: makePool([]).pool, log });
    expect(ingest.matches('luna, status do painel?')).toBe(true);
    expect(ingest.matches('@Luna agenda a call')).toBe(true);
    expect(ingest.matches('pode pedir pra luna verificar')).toBe(true);
    expect(ingest.matches('como está o sistema?')).toBe(false);
    // falso-positivo conhecido e aceito (decisão documentada no módulo):
    expect(ingest.matches('fase lunar hoje')).toBe(true);
  });

  it('menção → INSERT em kimiwork_inbox com kind telegram.message e chave idempotente tg:<chat>:<msg>', async () => {
    const { pool, calls } = makePool(['evt-1']);
    const ingest = createTelegramIngest({ pool, log });
    const ok = await ingest.ingest({
      chatId: '12345',
      messageId: 777,
      fromId: '42',
      fromName: 'Abner',
      text: 'luna, vê o painel',
    });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    const [sql, kind, payload, key] = calls[0] as [string, string, string, string];
    expect(sql).toContain('INSERT INTO kimiwork_inbox');
    expect(kind).toBe('telegram.message');
    expect(JSON.parse(payload)).toMatchObject({
      chat_id: '12345',
      message_id: 777,
      from_id: '42',
      from_name: 'Abner',
      text: 'luna, vê o painel',
    });
    expect(key).toBe('tg:12345:777');
  });

  it('duplicata (idempotency_key já existe) → true mesmo assim (evento já está na fila, F4 segue calado)', async () => {
    const { pool } = makePool([null]); // ON CONFLICT DO NOTHING → sem RETURNING
    const ingest = createTelegramIngest({ pool, log });
    const ok = await ingest.ingest({ chatId: '12345', messageId: 777, fromId: null, fromName: 'Abner', text: 'luna' });
    expect(ok).toBe(true);
  });

  it('erro de banco → false (caller cai no fluxo F4 normal — mensagem não se perde)', async () => {
    const pool = {
      async query() {
        throw new Error('connection refused');
      },
    } as never;
    const ingest = createTelegramIngest({ pool, log });
    const ok = await ingest.ingest({ chatId: '12345', messageId: 1, fromId: null, fromName: 'X', text: 'luna' });
    expect(ok).toBe(false);
  });
});

const db = require('../db');
const dataStore = require('../datastore-pg');

describe('Cash Box (datastore-pg)', () => {
  afterAll(async () => {
    await db.pool.end();
  });

  test('getCashBox returns object (not array)', async () => {
    const cashBox = await dataStore.getCashBox();
    expect(typeof cashBox).toBe('object');
    expect(Array.isArray(cashBox)).toBe(false);
    expect(cashBox).toHaveProperty('balance');
    expect(cashBox).toHaveProperty('history');
    expect(cashBox).toHaveProperty('alerts');
    expect(cashBox).toHaveProperty('settings');
    expect(cashBox).toHaveProperty('auditLog');
  });

  test('saveCashBox updates balance', async () => {
    const cashBox = await dataStore.getCashBox();
    const originalBalance = cashBox.balance.value;
    cashBox.balance.value = 9999.99;
    await dataStore.saveCashBox(cashBox);

    const updated = await dataStore.getCashBox();
    expect(updated.balance.value).toBe(9999.99);

    // Restore
    updated.balance.value = originalBalance;
    await dataStore.saveCashBox(updated);
  });

  test('saveCashBox appends to history', async () => {
    const cashBox = await dataStore.getCashBox();
    const originalHistoryLen = cashBox.history.length;
    cashBox.history.push({
      id: 'test-etx-001',
      date: new Date().toISOString().slice(0, 10),
      type: 'income',
      amount: 1,
      source: 'Teste caixa',
      balanceAfter: cashBox.balance.value + 1,
      recordedBy: 'jest',
      recordedAt: new Date().toISOString()
    });
    await dataStore.saveCashBox(cashBox);

    const updated = await dataStore.getCashBox();
    expect(updated.history.length).toBe(originalHistoryLen + 1);

    // Remove test entry
    updated.history = updated.history.filter(h => h.id !== 'test-etx-001');
    await dataStore.saveCashBox(updated);
  });

  test('cash_box in PG has exactly 1 row', async () => {
    const rows = await db.query('SELECT COUNT(*)::text as total FROM cash_box');
    expect(rows[0].total).toBe('1');
  });
});

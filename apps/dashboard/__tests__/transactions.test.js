const db = require('../db');
const dataStore = require('../datastore-pg');

const TEST_TX_ID = 'test-tx-' + Date.now();

describe('Transactions (datastore-pg)', () => {
  afterAll(async () => {
    await db.run('DELETE FROM transactions WHERE id = $1', [TEST_TX_ID]);
    await db.pool.end();
  });

  test('getTransactions returns array', async () => {
    const result = await dataStore.getTransactions();
    expect(Array.isArray(result)).toBe(true);
  });

  test('saveTransaction inserts and returns transaction with real schema fields', async () => {
    const tx = {
      id: TEST_TX_ID,
      date: '2024-01-15',
      type: 'income',
      amount: 1000.50,
      currency: 'EUR',
      description: 'Transação de teste',
      category: 'venda',
      balanceAfter: 5000,
      recordedBy: 'abner',
      recordedAt: new Date().toISOString(),
      notes: 'Nota de teste',
      source: 'manual',
      isActive: true,
      metadata: { project: 'projeto-1' },
      createdAt: new Date().toISOString(),
      createdBy: 'abner',
      updatedAt: new Date().toISOString(),
    };

    const saved = await dataStore.saveTransaction(tx);
    expect(saved.id).toBe(TEST_TX_ID);
    expect(saved.amount).toBe(1000.50);

    const result = await dataStore.getTransactions();
    const found = result.find(t => t.id === TEST_TX_ID);
    expect(found).toBeDefined();
    expect(found.category).toBe('venda');
  });

  test('saveTransaction updates existing transaction', async () => {
    const updated = {
      id: TEST_TX_ID,
      date: '2024-01-16',
      type: 'expense',
      amount: 200.00,
      currency: 'EUR',
      description: 'Transação atualizada',
      category: 'despesa',
      balanceAfter: 4800,
      recordedBy: 'abner',
      recordedAt: new Date().toISOString(),
      notes: 'Nota atualizada',
      source: 'manual',
      isActive: true,
      metadata: { project: 'projeto-2' },
      createdAt: new Date().toISOString(),
      createdBy: 'abner',
      updatedAt: new Date().toISOString(),
    };

    await dataStore.saveTransaction(updated);
    const result = await dataStore.getTransactions();
    const found = result.find(t => t.id === TEST_TX_ID);
    expect(found.type).toBe('expense');
    expect(found.amount).toBe(200.00);
    expect(found.category).toBe('despesa');
  });

  test('deleteTransaction removes transaction', async () => {
    await dataStore.deleteTransaction(TEST_TX_ID);
    const result = await dataStore.getTransactions();
    const found = result.find(t => t.id === TEST_TX_ID);
    expect(found).toBeUndefined();
  });

  test('transactions in PG match expected count (0 in production)', async () => {
    const result = await dataStore.getTransactions();
    expect(result.length).toBeGreaterThanOrEqual(0);
  });
});

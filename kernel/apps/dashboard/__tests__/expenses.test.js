const db = require('../db');
const dataStore = require('../datastore-pg');

const TEST_EXPENSE_ID = 'test-exp-' + Date.now();

describe('Expenses (datastore-pg)', () => {
  afterAll(async () => {
    await db.run('DELETE FROM expenses WHERE id = $1', [TEST_EXPENSE_ID]);
    await db.pool.end();
  });

  test('getExpenses returns array', async () => {
    const expenses = await dataStore.getExpenses();
    expect(Array.isArray(expenses)).toBe(true);
  });

  test('saveExpense inserts and returns expense with real schema fields', async () => {
    const expense = {
      id: TEST_EXPENSE_ID,
      name: 'Despesa Teste',
      description: 'Teste de despesa €50',
      amount: { value: 50, currency: 'EUR' },
      costPerPerson: { value: 25, currency: 'EUR' },
      type: 'one_time',
      period: null,
      periodLabel: '',
      startDate: null,
      renewDate: null,
      endDate: null,
      category: 'software',
      categoryLabel: 'Software',
      splitAmong: ['abner', 'elias'],
      paidBy: { abner: { paid: false, amount: 25 }, elias: { paid: false, amount: 25 } },
      fullyPaid: false,
      autoDeductFromCashBox: true,
      notes: 'Nota de teste',
      attachments: [],
      createdBy: 'abner',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const saved = await dataStore.saveExpense(expense);
    expect(saved.id).toBe(TEST_EXPENSE_ID);
    expect(saved.name).toBe('Despesa Teste');
    expect(saved.amount.value).toBe(50);
    expect(saved.splitAmong).toEqual(['abner', 'elias']);

    const expenses = await dataStore.getExpenses();
    const found = expenses.find(e => e.id === TEST_EXPENSE_ID);
    expect(found).toBeDefined();
    expect(found.category).toBe('software');
  });

  test('saveExpense updates existing expense', async () => {
    const updated = {
      id: TEST_EXPENSE_ID,
      name: 'Despesa Teste Atualizada',
      description: 'Descrição atualizada',
      amount: { value: 75, currency: 'EUR' },
      costPerPerson: { value: 37.5, currency: 'EUR' },
      type: 'one_time',
      period: null,
      periodLabel: '',
      startDate: null,
      renewDate: null,
      endDate: null,
      category: 'hardware',
      categoryLabel: 'Hardware',
      splitAmong: ['abner', 'elias', 'nonoke'],
      paidBy: { abner: { paid: true, amount: 25 }, elias: { paid: false, amount: 25 }, nonoke: { paid: false, amount: 25 } },
      fullyPaid: false,
      autoDeductFromCashBox: false,
      notes: 'Nota atualizada',
      attachments: [],
      createdBy: 'abner',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await dataStore.saveExpense(updated);
    const expenses = await dataStore.getExpenses();
    const found = expenses.find(e => e.id === TEST_EXPENSE_ID);
    expect(found.name).toBe('Despesa Teste Atualizada');
    expect(found.amount.value).toBe(75);
    expect(found.category).toBe('hardware');
  });

  test('deleteExpense removes expense', async () => {
    await dataStore.deleteExpense(TEST_EXPENSE_ID);
    const expenses = await dataStore.getExpenses();
    const found = expenses.find(e => e.id === TEST_EXPENSE_ID);
    expect(found).toBeUndefined();
  });

  test('expenses in PG match expected count (9 in production)', async () => {
    const expenses = await dataStore.getExpenses();
    expect(expenses.length).toBeGreaterThanOrEqual(9);
  });
});

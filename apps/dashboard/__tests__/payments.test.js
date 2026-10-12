const db = require('../db');
const dataStore = require('../datastore-pg');

const TEST_PAYMENT_ID = 'test-pay-' + Date.now();

describe('Payments (datastore-pg)', () => {
  afterAll(async () => {
    await db.run('DELETE FROM payments WHERE payment_id = $1', [TEST_PAYMENT_ID]);
    await db.pool.end();
  });

  test('getPayments returns array', async () => {
    const payments = await dataStore.getPayments();
    expect(Array.isArray(payments)).toBe(true);
  });

  test('savePayment inserts and returns payment with real schema fields', async () => {
    const payment = {
      paymentId: TEST_PAYMENT_ID,
      id: TEST_PAYMENT_ID,
      clientId: 'test-client',
      clientName: 'Cliente Teste',
      clientShortName: 'CT',
      projectName: 'Projeto Teste',
      projectId: 'test-proj',
      description: 'Pagamento de teste',
      totalAmount: { value: 100, currency: 'EUR' },
      equivalentEUR: { value: 100, currency: 'EUR' },
      status: 'pending',
      paymentTerms: { type: 'full', splits: [] },
      methodPreferred: 'transfer',
      methodAccepted: ['transfer', 'card'],
      revenueSplit: [],
      transactions: [],
      notes: 'Nota de teste',
      links: { invoice: 'http://teste.com' },
      companySharePercent: 25,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const saved = await dataStore.savePayment(payment);
    expect(saved.paymentId).toBe(TEST_PAYMENT_ID);
    expect(saved.totalAmount.value).toBe(100);
    expect(saved.clientShortName).toBe('CT');
    expect(saved.companySharePercent).toBe(25);

    const payments = await dataStore.getPayments();
    const found = payments.find(p => p.paymentId === TEST_PAYMENT_ID);
    expect(found).toBeDefined();
    expect(found.clientName).toBe('Cliente Teste');
  });

  test('savePayment updates existing payment', async () => {
    const updated = {
      paymentId: TEST_PAYMENT_ID,
      id: TEST_PAYMENT_ID,
      clientId: 'test-client',
      clientName: 'Cliente Teste Atualizado',
      clientShortName: 'CT',
      projectName: 'Projeto Teste',
      projectId: 'test-proj',
      description: 'Pagamento atualizado',
      totalAmount: { value: 150, currency: 'EUR' },
      status: 'partial',
      paymentTerms: { type: 'full', splits: [] },
      methodPreferred: 'transfer',
      methodAccepted: ['transfer', 'card'],
      revenueSplit: [],
      transactions: [],
      notes: 'Nota atualizada',
      links: {},
      companySharePercent: 30,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await dataStore.savePayment(updated);
    const payments = await dataStore.getPayments();
    const found = payments.find(p => p.paymentId === TEST_PAYMENT_ID);
    expect(found.clientName).toBe('Cliente Teste Atualizado');
    expect(found.totalAmount.value).toBe(150);
    expect(found.status).toBe('partial');
    expect(found.companySharePercent).toBe(30);
  });

  test('deletePayment removes payment', async () => {
    await dataStore.deletePayment(TEST_PAYMENT_ID);
    const payments = await dataStore.getPayments();
    const found = payments.find(p => p.paymentId === TEST_PAYMENT_ID);
    expect(found).toBeUndefined();
  });

  test('payments in PG match expected count (should be 0 in production)', async () => {
    const payments = await dataStore.getPayments();
    expect(payments.length).toBe(0);
  });
});

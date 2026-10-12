const db = require('../db');
const dataStore = require('../datastore-pg');

const TEST_QUOTE_ID = 'test-quote-' + Date.now();

describe('Quotes (datastore-pg)', () => {
  afterAll(async () => {
    await db.run('DELETE FROM quotes WHERE quote_id = $1', [TEST_QUOTE_ID]);
    await db.pool.end();
  });

  test('getQuotes returns array', async () => {
    const quotes = await dataStore.getQuotes();
    expect(Array.isArray(quotes)).toBe(true);
  });

  test('saveQuote inserts and returns quote with real schema fields', async () => {
    const quote = {
      quoteId: TEST_QUOTE_ID,
      id: TEST_QUOTE_ID,
      projectId: 'test-proj',
      projectName: 'Projeto Teste',
      clientName: 'Cliente Teste',
      clientId: 'test-client',
      status: 'draft',
      statusLabel: 'Rascunho',
      totalAmount: { value: 5000, currency: 'EUR' },
      monthlyFee: { value: 199, currency: 'EUR' },
      year1Investment: { value: 2000, currency: 'EUR' },
      discountUpfront: { percent: 10, amount: 500, currency: 'EUR' },
      items: [{ name: 'Item 1', value: 2500 }, { name: 'Item 2', value: 2500 }],
      githubUrl: 'https://github.com/test',
      createdAt: new Date().toISOString(),
      sentAt: null,
      validUntil: '2026-12-31',
      updatedAt: new Date().toISOString(),
    };

    const saved = await dataStore.saveQuote(quote);
    expect(saved.quoteId).toBe(TEST_QUOTE_ID);
    expect(saved.totalAmount.value).toBe(5000);
    expect(saved.monthlyFee.value).toBe(199);
    expect(saved.items.length).toBe(2);

    const quotes = await dataStore.getQuotes();
    const found = quotes.find(q => q.quoteId === TEST_QUOTE_ID);
    expect(found).toBeDefined();
    expect(found.clientName).toBe('Cliente Teste');
  });

  test('saveQuote updates existing quote', async () => {
    const updated = {
      quoteId: TEST_QUOTE_ID,
      id: TEST_QUOTE_ID,
      projectId: 'test-proj',
      projectName: 'Projeto Teste Atualizado',
      clientName: 'Cliente Atualizado',
      clientId: 'test-client',
      status: 'sent',
      statusLabel: 'Enviado',
      totalAmount: { value: 6000, currency: 'EUR' },
      monthlyFee: { value: 299, currency: 'EUR' },
      year1Investment: { value: 2500, currency: 'EUR' },
      discountUpfront: { percent: 15, amount: 750, currency: 'EUR' },
      items: [{ name: 'Item 1', value: 3000 }, { name: 'Item 2', value: 3000 }],
      githubUrl: 'https://github.com/test',
      createdAt: new Date().toISOString(),
      sentAt: new Date().toISOString(),
      validUntil: '2026-12-31',
      updatedAt: new Date().toISOString(),
    };

    await dataStore.saveQuote(updated);
    const quotes = await dataStore.getQuotes();
    const found = quotes.find(q => q.quoteId === TEST_QUOTE_ID);
    expect(found.projectName).toBe('Projeto Teste Atualizado');
    expect(found.totalAmount.value).toBe(6000);
    expect(found.status).toBe('sent');
  });

  test('deleteQuote removes quote', async () => {
    await dataStore.deleteQuote(TEST_QUOTE_ID);
    const quotes = await dataStore.getQuotes();
    const found = quotes.find(q => q.quoteId === TEST_QUOTE_ID);
    expect(found).toBeUndefined();
  });

  test('quotes in PG match expected count (4 in production)', async () => {
    const quotes = await dataStore.getQuotes();
    expect(quotes.length).toBeGreaterThanOrEqual(4);
  });
});

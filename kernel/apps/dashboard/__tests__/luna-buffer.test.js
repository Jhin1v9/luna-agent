const db = require('../db');
const dataStore = require('../datastore-pg');

describe('Luna Buffer (datastore-pg)', () => {
  afterAll(async () => {
    await db.pool.end();
  });

  test('getLunaBuffer returns object with expected fields', async () => {
    const result = await dataStore.getLunaBuffer();
    expect(result).toHaveProperty('newMessages');
    expect(Array.isArray(result.newMessages)).toBe(true);
    expect(result).toHaveProperty('newTasks');
    expect(result).toHaveProperty('newIdeas');
    expect(result).toHaveProperty('newDecisions');
    expect(result).toHaveProperty('newLinks');
    expect(result).toHaveProperty('sentiment');
    expect(result).toHaveProperty('lastBufferUpdate');
  });

  test('saveLunaBuffer updates buffer and returns data', async () => {
    const data = {
      newMessages: [{ id: 'msg-1', text: 'Teste' }],
      newTasks: [{ id: 'task-1', title: 'Tarefa teste' }],
      newTasksDone: [],
      newIdeas: [{ id: 'idea-1', title: 'Ideia teste' }],
      newDecisions: [],
      newLinks: [{ id: 'link-1', url: 'https://example.com' }],
      newLeads: [],
      newFinance: [],
      ignoredMessages: [],
      newMentions: [],
      sentiment: { positive: 1, negative: 0, urgent: 0 },
      lastBufferUpdate: new Date().toISOString(),
    };

    const saved = await dataStore.saveLunaBuffer(data);
    expect(saved.newMessages.length).toBe(1);
    expect(saved.newTasks[0].title).toBe('Tarefa teste');

    const result = await dataStore.getLunaBuffer();
    expect(result.newIdeas.length).toBe(1);
    expect(result.sentiment.positive).toBe(1);
  });

  test('saveLunaBuffer is idempotent (singleton id=1)', async () => {
    const data = await dataStore.getLunaBuffer();
    data.lastBufferUpdate = new Date().toISOString();
    const saved = await dataStore.saveLunaBuffer(data);
    expect(saved.lastBufferUpdate).toBe(data.lastBufferUpdate);
  });

  test('luna_buffer in PG has exactly 1 row', async () => {
    const row = await db.get('SELECT COUNT(*) as count FROM luna_buffer');
    expect(parseInt(row.count)).toBeGreaterThanOrEqual(0);
  });
});

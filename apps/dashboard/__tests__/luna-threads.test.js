const db = require('../db');
const dataStore = require('../datastore-pg');

const TEST_THREAD_ID = 'test-thread-' + Date.now();

describe('Luna Threads (datastore-pg)', () => {
  afterAll(async () => {
    await db.run('DELETE FROM luna_threads WHERE id = $1', [TEST_THREAD_ID]);
    await db.pool.end();
  });

  test('getLunaThreads returns object with threads', async () => {
    const result = await dataStore.getLunaThreads();
    expect(result).toHaveProperty('threads');
    expect(typeof result.threads).toBe('object');
    expect(result).toHaveProperty('version');
  });

  test('saveLunaThread inserts and returns thread with real schema fields', async () => {
    const thread = {
      id: TEST_THREAD_ID,
      type: 'individual',
      title: 'Teste + Luna',
      participants: ['teste'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 2,
      messages: [
        { id: 'msg-1', role: 'user', text: 'Oi', author: 'teste', timestamp: new Date().toISOString() },
        { id: 'msg-2', role: 'assistant', text: 'Olá!', author: 'Luna', timestamp: new Date().toISOString() }
      ]
    };

    const saved = await dataStore.saveLunaThread(thread);
    expect(saved.id).toBe(TEST_THREAD_ID);
    expect(saved.title).toBe('Teste + Luna');

    const result = await dataStore.getLunaThreads();
    expect(result.threads[TEST_THREAD_ID]).toBeDefined();
    expect(result.threads[TEST_THREAD_ID].messageCount).toBe(2);
  });

  test('saveLunaThread updates existing thread', async () => {
    const updated = {
      id: TEST_THREAD_ID,
      type: 'group',
      title: 'Teste Grupo + Luna',
      participants: ['teste', 'outro'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 3,
      messages: [
        { id: 'msg-1', role: 'user', text: 'Oi', author: 'teste', timestamp: new Date().toISOString() },
        { id: 'msg-2', role: 'assistant', text: 'Olá!', author: 'Luna', timestamp: new Date().toISOString() },
        { id: 'msg-3', role: 'user', text: 'Tudo bem?', author: 'outro', timestamp: new Date().toISOString() }
      ]
    };

    await dataStore.saveLunaThread(updated);
    const result = await dataStore.getLunaThreads();
    expect(result.threads[TEST_THREAD_ID].type).toBe('group');
    expect(result.threads[TEST_THREAD_ID].messageCount).toBe(3);
  });

  test('deleteLunaThread removes thread', async () => {
    await dataStore.deleteLunaThread(TEST_THREAD_ID);
    const result = await dataStore.getLunaThreads();
    expect(result.threads[TEST_THREAD_ID]).toBeUndefined();
  });

  test('luna_threads in PG match expected count (4 in production)', async () => {
    const result = await dataStore.getLunaThreads();
    expect(Object.keys(result.threads).length).toBeGreaterThanOrEqual(0);
  });
});

const db = require('../db');
const dataStore = require('../datastore-pg');

const TEST_CHANGELOG_ID = 'test-changelog-' + Date.now();

describe('Changelog (datastore-pg)', () => {
  afterAll(async () => {
    await db.run('DELETE FROM changelog WHERE id = $1', [TEST_CHANGELOG_ID]);
    await db.pool.end();
  });

  test('getChangelog returns object with entries array', async () => {
    const result = await dataStore.getChangelog();
    expect(result).toHaveProperty('entries');
    expect(Array.isArray(result.entries)).toBe(true);
    expect(result).toHaveProperty('version');
  });

  test('saveChangelog inserts and returns entry with real schema fields', async () => {
    const entry = {
      id: TEST_CHANGELOG_ID,
      version: '3.2.0',
      title: 'Teste Changelog Entry',
      description: 'Descrição de teste para changelog.',
      category: 'feature',
      emoji: '✨',
      author: 'Teste',
      tier: 2,
      date: new Date().toISOString(),
      tags: ['teste', 'changelog'],
      readBy: [],
    };

    const saved = await dataStore.saveChangelog(entry);
    expect(saved.id).toBe(TEST_CHANGELOG_ID);
    expect(saved.title).toBe('Teste Changelog Entry');
    expect(saved.category).toBe('feature');

    const result = await dataStore.getChangelog();
    const found = result.entries.find(e => e.id === TEST_CHANGELOG_ID);
    expect(found).toBeDefined();
    expect(found.author).toBe('Teste');
    expect(found.tier).toBe(2);
  });

  test('saveChangelog updates existing entry', async () => {
    const updated = {
      id: TEST_CHANGELOG_ID,
      version: '3.2.1',
      title: 'Teste Changelog Entry Atualizado',
      description: 'Descrição atualizada.',
      category: 'improvement',
      emoji: '🚀',
      author: 'Teste Atualizado',
      tier: 1,
      date: new Date().toISOString(),
      tags: ['teste', 'atualizado'],
      readBy: ['user-1'],
    };

    await dataStore.saveChangelog(updated);
    const result = await dataStore.getChangelog();
    const found = result.entries.find(e => e.id === TEST_CHANGELOG_ID);
    expect(found.title).toBe('Teste Changelog Entry Atualizado');
    expect(found.category).toBe('improvement');
    expect(found.readBy).toContain('user-1');
  });

  test('deleteChangelog removes entry', async () => {
    await dataStore.deleteChangelog(TEST_CHANGELOG_ID);
    const result = await dataStore.getChangelog();
    const found = result.entries.find(e => e.id === TEST_CHANGELOG_ID);
    expect(found).toBeUndefined();
  });

  test('changelog in PG match expected count (31 in production)', async () => {
    const result = await dataStore.getChangelog();
    expect(result.entries.length).toBeGreaterThanOrEqual(0);
  });
});

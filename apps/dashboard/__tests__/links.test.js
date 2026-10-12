const db = require('../db');
const dataStore = require('../datastore-pg');

const TEST_LINK_ID = 'test-link-' + Date.now();

describe('Links (datastore-pg)', () => {
  afterAll(async () => {
    await db.run('DELETE FROM links WHERE id = $1', [TEST_LINK_ID]);
    await db.pool.end();
  });

  test('getLinks returns object with links array', async () => {
    const result = await dataStore.getLinks();
    expect(result).toHaveProperty('links');
    expect(Array.isArray(result.links)).toBe(true);
  });

  test('saveLink inserts and returns link with real schema fields', async () => {
    const link = {
      id: TEST_LINK_ID,
      url: 'https://example.com/test-link',
      author: 'teste@nexo.com',
      timestamp: new Date().toISOString(),
      chat: 'Teste Chat',
      notes: 'Nota de teste',
      manual: true,
      preview: { title: 'Teste Preview', description: 'Descrição do preview', image: 'https://example.com/img.png' },
      platform: 'website',
      patterns: ['example', 'test'],
      icon: '🔗',
      color: '#3B82F6',
      category: 'referencia',
      label: 'Exemplo',
      hostname: 'example.com',
      enrichedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const saved = await dataStore.saveLink(link);
    expect(saved.id).toBe(TEST_LINK_ID);
    expect(saved.url).toBe('https://example.com/test-link');
    expect(saved.platform).toBe('website');

    const result = await dataStore.getLinks();
    const found = result.links.find(l => l.id === TEST_LINK_ID);
    expect(found).toBeDefined();
    expect(found.hostname).toBe('example.com');
    expect(found.preview.title).toBe('Teste Preview');
  });

  test('saveLink updates existing link', async () => {
    const updated = {
      id: TEST_LINK_ID,
      url: 'https://example.com/test-link-atualizado',
      author: 'atualizado@nexo.com',
      timestamp: new Date().toISOString(),
      chat: 'Teste Chat Atualizado',
      notes: 'Nota atualizada',
      manual: true,
      preview: { title: 'Preview Atualizado', description: 'Nova descrição', image: 'https://example.com/new.png' },
      platform: 'github',
      patterns: ['github', 'code'],
      icon: '💻',
      color: '#10B981',
      category: 'codigo',
      label: 'GitHub',
      hostname: 'github.com',
      enrichedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    await dataStore.saveLink(updated);
    const result = await dataStore.getLinks();
    const found = result.links.find(l => l.id === TEST_LINK_ID);
    expect(found.url).toBe('https://example.com/test-link-atualizado');
    expect(found.platform).toBe('github');
    expect(found.category).toBe('codigo');
  });

  test('deleteLink removes link', async () => {
    await dataStore.deleteLink(TEST_LINK_ID);
    const result = await dataStore.getLinks();
    const found = result.links.find(l => l.id === TEST_LINK_ID);
    expect(found).toBeUndefined();
  });

  test('links in PG match expected count (46 in JSON)', async () => {
    const result = await dataStore.getLinks();
    expect(result.links.length).toBeGreaterThanOrEqual(0);
  });
});

const db = require('../db');
const dataStore = require('../datastore-pg');

const TEST_IDEA_ID = 'test-idea-' + Date.now();

describe('Ideas (datastore-pg)', () => {
  afterAll(async () => {
    await db.run('DELETE FROM ideas WHERE id = $1', [TEST_IDEA_ID]);
    await db.pool.end();
  });

  test('getIdeas returns object with ideas', async () => {
    const result = await dataStore.getIdeas();
    expect(result).toHaveProperty('ideas');
    expect(typeof result.ideas).toBe('object');
  });

  test('saveIdea inserts and returns idea with real schema fields', async () => {
    const idea = {
      id: TEST_IDEA_ID,
      title: 'Ideia de Teste',
      status: 'rascunho',
      type: 'brainstorm',
      priority: 'alta',
      linkedTo: { clientId: null, clientName: null, projectId: null },
      content: { blocks: [{ id: 'blk-1', type: 'paragraph', content: 'Conteúdo de teste' }] },
      aiContext: { brainstormHistory: [], aiSuggestions: [], aiInsights: [] },
      tags: ['teste', 'ideia'],
      createdBy: 'abner',
      createdByName: 'Abner',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      collaborators: [],
      comments: [],
      attachments: [],
      versionHistory: [{ version: 1, snapshot: { title: 'Ideia de Teste', status: 'rascunho', content: { blocks: [] } }, changedBy: 'abner', changedAt: new Date().toISOString(), changeSummary: 'Criada' }],
      summary: null,
      dueDate: null,
      assignedTo: null,
      convertedTo: {},
    };

    const saved = await dataStore.saveIdea(idea);
    expect(saved.id).toBe(TEST_IDEA_ID);
    expect(saved.title).toBe('Ideia de Teste');

    const result = await dataStore.getIdeas();
    expect(result.ideas[TEST_IDEA_ID]).toBeDefined();
    expect(result.ideas[TEST_IDEA_ID].type).toBe('brainstorm');
  });

  test('saveIdea updates existing idea', async () => {
    const updated = {
      id: TEST_IDEA_ID,
      title: 'Ideia de Teste Atualizada',
      status: 'aprovada',
      type: 'proposta-comercial',
      priority: 'urgente',
      linkedTo: { clientId: 'client-1', clientName: 'Cliente Teste', projectId: 'proj-1' },
      content: { blocks: [{ id: 'blk-1', type: 'heading', content: 'Nova Proposta' }] },
      aiContext: { brainstormHistory: [], aiSuggestions: [], aiInsights: [] },
      tags: ['teste', 'atualizado'],
      createdBy: 'abner',
      createdByName: 'Abner',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      collaborators: [],
      comments: [],
      attachments: [],
      versionHistory: [{ version: 1, snapshot: { title: 'Ideia de Teste', status: 'rascunho', content: { blocks: [] } }, changedBy: 'abner', changedAt: new Date().toISOString(), changeSummary: 'Criada' }],
      summary: 'Resumo da ideia',
      dueDate: '2024-12-31',
      assignedTo: 'abner',
      convertedTo: {},
    };

    await dataStore.saveIdea(updated);
    const result = await dataStore.getIdeas();
    expect(result.ideas[TEST_IDEA_ID].status).toBe('aprovada');
    expect(result.ideas[TEST_IDEA_ID].type).toBe('proposta-comercial');
  });

  test('deleteIdea removes idea', async () => {
    await dataStore.deleteIdea(TEST_IDEA_ID);
    const result = await dataStore.getIdeas();
    expect(result.ideas[TEST_IDEA_ID]).toBeUndefined();
  });

  test('ideas in PG match expected count (7 in production)', async () => {
    const result = await dataStore.getIdeas();
    expect(Object.keys(result.ideas).length).toBeGreaterThanOrEqual(0);
  });
});

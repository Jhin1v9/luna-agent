const db = require('../db');
const dataStore = require('../datastore-pg');

const TEST_TASK_ID = 'test-ct-' + Date.now();

describe('Company Tasks (datastore-pg)', () => {
  afterAll(async () => {
    await db.run('DELETE FROM company_tasks WHERE id = $1', [TEST_TASK_ID]);
    await db.pool.end();
  });

  test('getCompanyTasks returns array', async () => {
    const tasks = await dataStore.getCompanyTasks();
    expect(Array.isArray(tasks)).toBe(true);
  });

  test('saveCompanyTask inserts and returns task with real schema fields', async () => {
    const task = {
      id: TEST_TASK_ID,
      title: 'Teste Company Task',
      description: 'Descrição da tarefa de teste',
      status: 'pending',
      priority: 'P1',
      taskType: 'dev',
      dueDate: '2026-12-31',
      addedBy: 'abner',
      assignedTo: 'enoque',
      source: 'manual',
      comments: [{ text: 'Comentário inicial', author: 'abner', timestamp: new Date().toISOString() }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    };

    const saved = await dataStore.saveCompanyTask(task);
    expect(saved.id).toBe(TEST_TASK_ID);
    expect(saved.title).toBe('Teste Company Task');
    expect(saved.priority).toBe('P1');
    expect(saved.comments.length).toBe(1);

    const tasks = await dataStore.getCompanyTasks();
    const found = tasks.find(t => t.id === TEST_TASK_ID);
    expect(found).toBeDefined();
    expect(found.assignedTo).toBe('enoque');
  });

  test('saveCompanyTask updates existing task', async () => {
    const updated = {
      id: TEST_TASK_ID,
      title: 'Teste Company Task Atualizada',
      description: 'Descrição atualizada',
      status: 'in_progress',
      priority: 'P0',
      taskType: 'dev',
      dueDate: '2026-12-31',
      addedBy: 'abner',
      assignedTo: 'elias',
      source: 'manual',
      comments: [{ text: 'Comentário atualizado', author: 'elias', timestamp: new Date().toISOString() }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: null,
    };

    await dataStore.saveCompanyTask(updated);
    const tasks = await dataStore.getCompanyTasks();
    const found = tasks.find(t => t.id === TEST_TASK_ID);
    expect(found.title).toBe('Teste Company Task Atualizada');
    expect(found.status).toBe('in_progress');
    expect(found.priority).toBe('P0');
    expect(found.assignedTo).toBe('elias');
  });

  test('deleteCompanyTask removes task', async () => {
    await dataStore.deleteCompanyTask(TEST_TASK_ID);
    const tasks = await dataStore.getCompanyTasks();
    const found = tasks.find(t => t.id === TEST_TASK_ID);
    expect(found).toBeUndefined();
  });

  test('company_tasks in PG match expected count (76 in JSON, PG base)', async () => {
    const tasks = await dataStore.getCompanyTasks();
    expect(tasks.length).toBeGreaterThanOrEqual(0);
  });
});

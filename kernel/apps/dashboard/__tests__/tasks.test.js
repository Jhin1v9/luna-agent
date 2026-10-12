const db = require('../db');
const dataStore = require('../datastore-pg');

const TEST_TASK_ID = 'test-task-' + Date.now();

afterAll(async () => {
  await db.run('DELETE FROM tasks WHERE id = $1', [TEST_TASK_ID]);
  await db.pool.end();
});

describe('Tasks (datastore-pg)', () => {
  test('getTasks returns array', async () => {
    const tasks = await dataStore.getTasks();
    expect(Array.isArray(tasks)).toBe(true);
  });

  test('saveTask inserts and returns task', async () => {
    const task = {
      id: TEST_TASK_ID,
      title: 'Test Task from Jest',
      description: 'Integration test',
      status: 'pending',
      priority: 'high',
      taskType: 'test',
      dueDate: null,
      addedBy: 'abner',
      assignedTo: 'elias',
      source: 'jest',
      comments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const saved = await dataStore.saveTask(task);
    expect(saved.id).toBe(TEST_TASK_ID);
    expect(saved.title).toBe('Test Task from Jest');

    const tasks = await dataStore.getTasks();
    const found = tasks.find(t => t.id === TEST_TASK_ID);
    expect(found).toBeDefined();
    expect(found.status).toBe('pending');
  });

  test('deleteTask removes task', async () => {
    // Task already created above
    const result = await dataStore.deleteTask(TEST_TASK_ID);
    expect(result).toBe(true);

    const tasks = await dataStore.getTasks();
    const found = tasks.find(t => t.id === TEST_TASK_ID);
    expect(found).toBeUndefined();
  });

});

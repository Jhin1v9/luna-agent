const db = require('../db');
const dataStore = require('../datastore-pg');

const TEST_USER_ID = 'test-user-' + Date.now();

afterAll(async () => {
  await db.run('DELETE FROM users WHERE id = $1', [TEST_USER_ID]);
  await db.pool.end();
});

describe('Users (datastore-pg)', () => {
  test('getUsers returns object with users and active', async () => {
    const result = await dataStore.getUsers();
    expect(result).toHaveProperty('users');
    expect(result).toHaveProperty('active', 'abner');
    expect(typeof result.users).toBe('object');
  });

  test('saveUser inserts and updates', async () => {
    await dataStore.saveUser(TEST_USER_ID, {
      name: 'Test User',
      role: 'Developer',
      color: '#ff0000',
      password: 'hashedpw',
      discordId: '123456',
    });

    const result = await dataStore.getUsers();
    expect(result.users[TEST_USER_ID]).toMatchObject({
      name: 'Test User',
      role: 'Developer',
      discordId: '123456',
    });

    // Update
    await dataStore.saveUser(TEST_USER_ID, {
      name: 'Test User Updated',
      role: 'Admin',
      color: '#ff0000',
      password: 'hashedpw',
    });

    const updated = await dataStore.getUsers();
    expect(updated.users[TEST_USER_ID].name).toBe('Test User Updated');
    expect(updated.users[TEST_USER_ID].role).toBe('Admin');
  });

  test('users in PG match expected production count', async () => {
    const result = await dataStore.getUsers();
    const count = Object.keys(result.users).length;
    expect(count).toBeGreaterThanOrEqual(3); // abner, nonoke, elias
  });
});

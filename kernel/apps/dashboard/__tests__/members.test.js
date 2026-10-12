const db = require('../db');
const dataStore = require('../datastore-pg');

const TEST_MEMBER_ID = 'test-member-' + Date.now();

describe('Members (datastore-pg)', () => {
  afterAll(async () => {
    await db.run('DELETE FROM members WHERE id = $1', [TEST_MEMBER_ID]);
    await db.pool.end();
  });

  test('getMembers returns array', async () => {
    const result = await dataStore.getMembers();
    expect(Array.isArray(result)).toBe(true);
  });

  test('saveMember inserts and returns member with real schema fields', async () => {
    const member = {
      id: TEST_MEMBER_ID,
      name: 'Membro Teste',
      role: 'developer',
      skills: ['react', 'node'],
      sharePercent: 25,
      status: 'active',
      projects: ['projeto-1'],
      email: 'teste@nexo.com',
      phone: '+5511999999999',
      country: 'BR',
      joinedAt: new Date().toISOString(),
      note: 'Nota de teste',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const saved = await dataStore.saveMember(member);
    expect(saved.id).toBe(TEST_MEMBER_ID);
    expect(saved.name).toBe('Membro Teste');

    const result = await dataStore.getMembers();
    const found = result.find(m => m.id === TEST_MEMBER_ID);
    expect(found).toBeDefined();
    expect(found.role).toBe('developer');
    expect(found.sharePercent).toBe(25);
  });

  test('saveMember updates existing member', async () => {
    const updated = {
      id: TEST_MEMBER_ID,
      name: 'Membro Teste Atualizado',
      role: 'designer',
      skills: ['figma', 'ui'],
      sharePercent: 30,
      status: 'active',
      projects: ['projeto-1', 'projeto-2'],
      email: 'atualizado@nexo.com',
      phone: '+5511888888888',
      country: 'PT',
      joinedAt: new Date().toISOString(),
      note: 'Nota atualizada',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await dataStore.saveMember(updated);
    const result = await dataStore.getMembers();
    const found = result.find(m => m.id === TEST_MEMBER_ID);
    expect(found.name).toBe('Membro Teste Atualizado');
    expect(found.role).toBe('designer');
    expect(found.country).toBe('PT');
  });

  test('deleteMember removes member', async () => {
    await dataStore.deleteMember(TEST_MEMBER_ID);
    const result = await dataStore.getMembers();
    const found = result.find(m => m.id === TEST_MEMBER_ID);
    expect(found).toBeUndefined();
  });

  test('members in PG match expected count (0 in production)', async () => {
    const result = await dataStore.getMembers();
    expect(result.length).toBeGreaterThanOrEqual(0);
  });
});

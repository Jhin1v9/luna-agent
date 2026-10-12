const db = require('../db');
const dataStore = require('../datastore-pg');

const TEST_NOTIF_ID = 'test-notif-' + Date.now();

describe('Notifications (datastore-pg)', () => {
  afterAll(async () => {
    await db.run('DELETE FROM notifications WHERE id = $1', [TEST_NOTIF_ID]);
    await db.pool.end();
  });

  test('getNotifications returns object with notifications array', async () => {
    const result = await dataStore.getNotifications();
    expect(result).toHaveProperty('version', '1.0');
    expect(result).toHaveProperty('notifications');
    expect(Array.isArray(result.notifications)).toBe(true);
  });

  test('saveNotification inserts and returns notification', async () => {
    const notif = {
      id: TEST_NOTIF_ID,
      type: 'test',
      title: 'Teste Notificação',
      message: 'Mensagem de teste para notificações',
      severity: 'medium',
      read: false,
      timestamp: new Date().toISOString(),
      metadata: { test: true, source: 'jest' },
      createdAt: new Date().toISOString(),
    };

    const saved = await dataStore.saveNotification(notif);
    expect(saved.id).toBe(TEST_NOTIF_ID);
    expect(saved.title).toBe('Teste Notificação');
    expect(saved.read).toBe(false);

    const result = await dataStore.getNotifications();
    const found = result.notifications.find(n => n.id === TEST_NOTIF_ID);
    expect(found).toBeDefined();
    expect(found.message).toBe('Mensagem de teste para notificações');
    expect(found.metadata.test).toBe(true);
  });

  test('saveNotification updates existing notification (mark as read)', async () => {
    const updated = {
      id: TEST_NOTIF_ID,
      type: 'test',
      title: 'Teste Notificação Atualizada',
      message: 'Mensagem de teste para notificações',
      severity: 'high',
      read: true,
      timestamp: new Date().toISOString(),
      metadata: { test: true, source: 'jest' },
      createdAt: new Date().toISOString(),
    };

    await dataStore.saveNotification(updated);
    const result = await dataStore.getNotifications();
    const found = result.notifications.find(n => n.id === TEST_NOTIF_ID);
    expect(found.read).toBe(true);
    expect(found.severity).toBe('high');
    expect(found.title).toBe('Teste Notificação Atualizada');
  });

  test('deleteNotification removes notification', async () => {
    await dataStore.deleteNotification(TEST_NOTIF_ID);
    const result = await dataStore.getNotifications();
    const found = result.notifications.find(n => n.id === TEST_NOTIF_ID);
    expect(found).toBeUndefined();
  });

  test('notifications in PG match expected count (12 in production)', async () => {
    const result = await dataStore.getNotifications();
    expect(result.notifications.length).toBeGreaterThanOrEqual(12);
  });
});

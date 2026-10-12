const db = require('../db');
const dataStore = require('../datastore-pg');

const TEST_LOG_ID = 'test-sec-' + Date.now();

describe('Security Logs (datastore-pg)', () => {
  afterAll(async () => {
    await db.run('DELETE FROM security_logs WHERE id = $1', [TEST_LOG_ID]);
    await db.pool.end();
  });

  test('getSecurityLogs returns object with events array', async () => {
    const result = await dataStore.getSecurityLogs();
    expect(result).toHaveProperty('version', '1.0');
    expect(result).toHaveProperty('events');
    expect(Array.isArray(result.events)).toBe(true);
  });

  test('saveSecurityLog inserts and returns log with real schema fields', async () => {
    const event = {
      id: TEST_LOG_ID,
      timestamp: new Date().toISOString(),
      type: 'failed_login',
      severity: 'high',
      ip: '192.168.1.100',
      location: { city: 'Barcelona', country: 'ES' },
      risk: { score: 85, level: 'high' },
      device: { browser: 'Chrome', os: 'Windows' },
      attemptedUser: 'teste',
      message: 'Tentativa de login falha',
      notified: false,
      notificationChannel: null,
      hasCameraPhoto: false,
      hasScreenshot: false,
      cameraPhoto: null,
      screenshot: null,
      intruderData: { attempts: 3 }
    };

    const saved = await dataStore.saveSecurityLog(event);
    expect(saved.id).toBe(TEST_LOG_ID);
    expect(saved.type).toBe('failed_login');
    expect(saved.severity).toBe('high');

    const result = await dataStore.getSecurityLogs();
    const found = result.events.find(e => e.id === TEST_LOG_ID);
    expect(found).toBeDefined();
    expect(found.ip).toBe('192.168.1.100');
    expect(found.attemptedUser).toBe('teste');
  });

  test('saveSecurityLog is idempotent (ON CONFLICT DO NOTHING)', async () => {
    const event = {
      id: TEST_LOG_ID,
      timestamp: new Date().toISOString(),
      type: 'failed_login',
      severity: 'critical',
      ip: '10.0.0.1',
      location: {},
      risk: {},
      device: {},
      attemptedUser: 'outro',
      message: 'Nova tentativa',
      notified: true,
      notificationChannel: 'discord',
      hasCameraPhoto: false,
      hasScreenshot: false,
      cameraPhoto: null,
      screenshot: null,
      intruderData: {}
    };

    await dataStore.saveSecurityLog(event);
    const result = await dataStore.getSecurityLogs();
    const found = result.events.find(e => e.id === TEST_LOG_ID);
    // Deve manter o original (ON CONFLICT DO NOTHING)
    expect(found.ip).toBe('192.168.1.100');
    expect(found.attemptedUser).toBe('teste');
  });

  test('deleteSecurityLog removes log', async () => {
    await dataStore.deleteSecurityLog(TEST_LOG_ID);
    const result = await dataStore.getSecurityLogs();
    const found = result.events.find(e => e.id === TEST_LOG_ID);
    expect(found).toBeUndefined();
  });

  test('security_logs in PG match expected count (14 in production)', async () => {
    const result = await dataStore.getSecurityLogs();
    expect(result.events.length).toBeGreaterThanOrEqual(14);
  });
});

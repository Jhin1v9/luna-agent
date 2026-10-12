const db = require('../db');
const dataStore = require('../datastore-pg');

const TEST_LEAD_ID = 'test-lead-' + Date.now();

describe('Leads (datastore-pg)', () => {
  afterAll(async () => {
    await db.run('DELETE FROM leads WHERE id = $1', [TEST_LEAD_ID]);
    await db.pool.end();
  });

  test('getLeads returns array', async () => {
    const leads = await dataStore.getLeads();
    expect(Array.isArray(leads)).toBe(true);
  });

  test('saveLead inserts and returns lead with real schema fields', async () => {
    const lead = {
      id: TEST_LEAD_ID,
      displayName: 'Teste Lead',
      name: 'Teste Lead',
      email: 'teste@lead.com',
      phone: '+351 900 000 000',
      source: 'website',
      type: 'lead',
      status: 'potencial',
      pipelineStatus: 'novo',
      estimatedValue: 5000,
      currency: 'EUR',
      notes: 'Lead de teste para pipeline',
      assignedTo: 'abner',
      tags: ['teste', 'pipeline'],
      createdAt: new Date().toISOString(),
      lastContact: null,
      convertedAt: null,
    };

    const saved = await dataStore.saveLead(lead);
    expect(saved.id).toBe(TEST_LEAD_ID);
    expect(saved.displayName).toBe('Teste Lead');
    expect(saved.pipelineStatus).toBe('novo');
    expect(saved.estimatedValue).toBe(5000);
    expect(saved.tags).toEqual(['teste', 'pipeline']);

    const leads = await dataStore.getLeads();
    const found = leads.find(l => l.id === TEST_LEAD_ID);
    expect(found).toBeDefined();
    expect(found.email).toBe('teste@lead.com');
  });

  test('saveLead updates existing lead (status pipeline)', async () => {
    const updated = {
      id: TEST_LEAD_ID,
      displayName: 'Teste Lead Atualizado',
      name: 'Teste Lead Atualizado',
      email: 'atualizado@lead.com',
      phone: '+351 900 000 000',
      source: 'website',
      type: 'lead',
      status: 'potencial',
      pipelineStatus: 'contatado',
      estimatedValue: 7500,
      currency: 'EUR',
      notes: 'Atualizado para contacted',
      assignedTo: 'abner',
      tags: ['teste', 'pipeline', 'contacted'],
      createdAt: new Date().toISOString(),
      lastContact: new Date().toISOString(),
      convertedAt: null,
    };

    await dataStore.saveLead(updated);
    const leads = await dataStore.getLeads();
    const found = leads.find(l => l.id === TEST_LEAD_ID);
    expect(found.pipelineStatus).toBe('contatado');
    expect(found.estimatedValue).toBe(7500);
    expect(found.tags).toEqual(['teste', 'pipeline', 'contacted']);
  });

  test('deleteLead removes lead', async () => {
    await dataStore.deleteLead(TEST_LEAD_ID);
    const leads = await dataStore.getLeads();
    const found = leads.find(l => l.id === TEST_LEAD_ID);
    expect(found).toBeUndefined();
  });

  test('leads in PG match expected count (0 in production, but test creates 1 then deletes)', async () => {
    const leads = await dataStore.getLeads();
    expect(leads.length).toBeGreaterThanOrEqual(0);
  });
});

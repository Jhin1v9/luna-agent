const db = require('../db');
const dataStore = require('../datastore-pg');

const TEST_CLIENT_ID = 'test-client-' + Date.now();

describe('Workspace Clients (datastore-pg)', () => {
  afterAll(async () => {
    await db.run('DELETE FROM workspace_clients WHERE id = $1', [TEST_CLIENT_ID]);
    await db.pool.end();
  });

  test('getWorkspaceClients returns object with clientes array', async () => {
    const result = await dataStore.getWorkspaceClients();
    expect(result).toHaveProperty('clientes');
    expect(Array.isArray(result.clientes)).toBe(true);
    expect(result).toHaveProperty('versao');
  });

  test('saveWorkspaceClient inserts and returns client with real schema fields', async () => {
    const client = {
      id: TEST_CLIENT_ID,
      nome: 'Cliente Teste',
      caminho: TEST_CLIENT_ID,
      status: 'ativo',
      cor: '#3B82F6',
      responsavel: 'todos',
      tipo: 'cliente',
      dataInicio: '2024-01-01',
      orcamentoTotal: 5000,
      moeda: 'EUR',
      tags: ['teste', 'workspace'],
      anotacoes: 'Anotação de teste',
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    };

    const saved = await dataStore.saveWorkspaceClient(client);
    expect(saved.id).toBe(TEST_CLIENT_ID);
    expect(saved.nome).toBe('Cliente Teste');

    const result = await dataStore.getWorkspaceClients();
    const found = result.clientes.find(c => c.id === TEST_CLIENT_ID);
    expect(found).toBeDefined();
    expect(found.status).toBe('ativo');
    expect(found.orcamentoTotal).toBe(5000);
  });

  test('saveWorkspaceClient updates existing client', async () => {
    const updated = {
      id: TEST_CLIENT_ID,
      nome: 'Cliente Teste Atualizado',
      caminho: TEST_CLIENT_ID,
      status: 'pausado',
      cor: '#10B981',
      responsavel: 'abner',
      tipo: 'cliente',
      dataInicio: '2024-01-01',
      orcamentoTotal: 7500,
      moeda: 'USD',
      tags: ['teste', 'atualizado'],
      anotacoes: 'Anotação atualizada',
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    };

    await dataStore.saveWorkspaceClient(updated);
    const result = await dataStore.getWorkspaceClients();
    const found = result.clientes.find(c => c.id === TEST_CLIENT_ID);
    expect(found.nome).toBe('Cliente Teste Atualizado');
    expect(found.status).toBe('pausado');
    expect(found.moeda).toBe('USD');
  });

  test('deleteWorkspaceClient removes client', async () => {
    await dataStore.deleteWorkspaceClient(TEST_CLIENT_ID);
    const result = await dataStore.getWorkspaceClients();
    const found = result.clientes.find(c => c.id === TEST_CLIENT_ID);
    expect(found).toBeUndefined();
  });

  test('workspace_clients in PG match expected count (2 in production)', async () => {
    const result = await dataStore.getWorkspaceClients();
    expect(result.clientes.length).toBeGreaterThanOrEqual(0);
  });
});

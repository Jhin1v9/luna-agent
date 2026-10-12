require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // Read and split migration 005 to skip the problematic workspace_clients block
  const sql005 = fs.readFileSync(path.join(__dirname, 'migrations', '005-real-schema.sql'), 'utf-8');
  
  // Split at the workspace_clients section and reconstruct without the backup/restore
  const parts = sql005.split('-- WORKSPACE_CLIENTS');
  const beforeWorkspace = parts[0];
  const afterWorkspace = parts[1].split('DROP TABLE IF EXISTS workspace_clients_backup;')[1];
  
  // Safe SQL: before workspace + simple workspace_clients CREATE + after
  const safeSql = beforeWorkspace + `
-- WORKSPACE_CLIENTS (empty — simple recreate)
DROP TABLE IF EXISTS workspace_clients;
CREATE TABLE workspace_clients (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  caminho TEXT NOT NULL,
  status TEXT DEFAULT 'ativo',
  cor TEXT DEFAULT '#3b82f6',
  responsavel TEXT DEFAULT 'todos',
  tipo TEXT DEFAULT 'cliente',
  data_inicio DATE,
  orcamento_total NUMERIC DEFAULT 0,
  moeda TEXT DEFAULT 'EUR',
  tags JSONB DEFAULT '[]',
  anotacoes TEXT DEFAULT '',
  versao TEXT DEFAULT '1.0',
  ultima_atualizacao TIMESTAMPTZ DEFAULT NOW(),
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);
` + afterWorkspace;

  console.log('🚀 Applying migration 005-real-schema.sql (safe version)...');
  await client.query(safeSql);
  console.log('✅ Migration 005 applied.');

  const sql6 = fs.readFileSync(path.join(__dirname, 'migrations', '006-changelog-status.sql'), 'utf-8');
  console.log('🚀 Applying migration 006-changelog-status.sql...');
  await client.query(sql6);
  console.log('✅ Migration 006 applied.');

  await client.end();
}

run().catch(e => { console.error('❌ Migration failed:', e); process.exit(1); });

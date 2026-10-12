require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '005-real-schema.sql'), 'utf-8');
  console.log('🚀 Applying migration 005-real-schema.sql...');
  await client.query(sql);
  console.log('✅ Migration 005 applied.');

  const sql6 = fs.readFileSync(path.join(__dirname, 'migrations', '006-changelog-status.sql'), 'utf-8');
  console.log('🚀 Applying migration 006-changelog-status.sql...');
  await client.query(sql6);
  console.log('✅ Migration 006 applied.');

  await client.end();
}

run().catch(e => { console.error('❌ Migration failed:', e); process.exit(1); });

require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function register() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const files = fs.readdirSync(path.join(__dirname, 'migrations'))
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    await client.query(
      'INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
      [file]
    );
    console.log(`✅ Registered ${file}`);
  }

  console.log('\n📋 All migrations registered.');
  await client.end();
}

register().catch(e => { console.error('❌ Failed:', e); process.exit(1); });

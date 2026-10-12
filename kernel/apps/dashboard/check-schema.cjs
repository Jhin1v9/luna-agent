require('dotenv').config();
const { Client } = require('pg');

async function check() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  for (const t of tables.rows) {
    const tn = t.tablename;
    const cols = await client.query(
      'SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position',
      [tn]
    );
    console.log('\n===', tn, '===');
    cols.rows.forEach(r => console.log('  ', r.column_name, '-', r.data_type));
  }
  await client.end();
}
check().catch(e => { console.error(e); process.exit(1); });

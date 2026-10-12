const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function query(sql, params) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

const tables = [
  'users','tasks','company_tasks','payments','expenses','cash_box',
  'quotes','leads','members','transactions','links','notifications',
  'security_logs','settings','workspace_clients','ideas','changelog',
  'whatsapp_history','luna_threads','luna_buffer'
];

(async () => {
  for (const table of tables) {
    console.log('\n=== ' + table.toUpperCase() + ' COLUMNS ===');
    const cols = await query(
      "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
      [table]
    );
    cols.forEach(c => console.log(c.column_name + ' | ' + c.data_type + ' | ' + c.is_nullable));
  }
  await pool.end();
})();

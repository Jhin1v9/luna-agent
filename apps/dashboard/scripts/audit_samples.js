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
    console.log('\n=== SAMPLE: ' + table.toUpperCase() + ' ===');
    try {
      const rows = await query(`SELECT * FROM ${table} LIMIT 2`);
      if (rows.length === 0) {
        console.log('(no data)');
      } else {
        rows.forEach((r, i) => {
          console.log('--- row ' + (i + 1) + ' ---');
          console.log(JSON.stringify(r, null, 2).slice(0, 3000));
        });
      }
    } catch (e) {
      console.log('ERROR: ' + e.message);
    }
  }
  await pool.end();
})();

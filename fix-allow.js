require('dotenv').config();
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect()
  .then(() => c.query("UPDATE chat_registry SET role='allowed' WHERE chat_name ILIKE '%App de Transporte%'"))
  .then(r => { console.log('updated:', r.rowCount); return c.query("SELECT chat_name, role FROM chat_registry WHERE chat_name ILIKE '%App de Transporte%'"); })
  .then(r => { console.log(r.rows); c.end(); })
  .catch(e => { console.error(e.message); c.end(); });

require('dotenv').config();
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect()
  .then(() => c.query("UPDATE chat_registry SET chat_key = 'app-transporte-caminhoneiros' WHERE id = '6'"))
  .then(r => { console.log('updated:', r.rowCount); return c.query("SELECT id, chat_key, kind, canonical_name, role FROM chat_registry WHERE id = '6'"); })
  .then(r => { console.log('DEPOIS:', r.rows); c.end(); })
  .catch(e => { console.error(e.message); c.end(); });

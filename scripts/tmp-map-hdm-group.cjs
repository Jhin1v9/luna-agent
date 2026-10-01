const { Pool } = require('pg');
const fs = require('fs');
const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }),
);
const pool = new Pool({ connectionString: env.DATABASE_URL });

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO clients (code, name, organization_id, status)
       VALUES ($1, $2, $3, 'active') ON CONFLICT DO NOTHING`,
      ['hdm-industrial', 'HDM Industrial', '557e9c4f-da87-42f4-a02b-d7c133bee9d1'],
    );
    const clientId = (await client.query('SELECT id FROM clients WHERE code=$1', ['hdm-industrial'])).rows[0].id;
    await client.query(
      `INSERT INTO contacts (client_id, name, channel, address, is_primary)
       VALUES ($1, $2, $3, $4, true) ON CONFLICT DO NOTHING`,
      [clientId, 'HDM - Industrial (SBD) - 26', 'whatsapp', '120363428577835024@g.us'],
    );
    const contactId = (await client.query('SELECT id FROM contacts WHERE address=$1', ['120363428577835024@g.us'])).rows[0].id;
    await client.query(
      `INSERT INTO conversations (client_id, contact_id, channel, state)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [clientId, contactId, 'whatsapp', 'open'],
    );
    const convId = (await client.query('SELECT id FROM conversations WHERE contact_id=$1', [contactId])).rows[0].id;
    const body = 'Oi, Matheus! Sou a Luna, da Nexo Digital 👋 Estou me conectando aqui no grupo pra acompanhar o projeto de vocês de perto. Qualquer novidade do site eu comunico por aqui na hora. E me conta: tá tudo rodando bem do seu lado? Se notar qualquer coisa, é só falar por aqui mesmo!';
    const msg = await client.query(
      `INSERT INTO messages (conversation_id, direction, channel, sender, body, send_state, author_name, metadata)
       VALUES ($1, 'outbound', 'whatsapp', 'luna', $2, 'queued', 'Luna', $3) RETURNING id`,
      [convId, body, JSON.stringify({ group_mapping_test: true })],
    );
    await client.query('SELECT pg_notify($1, $2)', ['luna_outbound', msg.rows[0].id]);
    await client.query('COMMIT');
    console.log('OK client=%s contact=%s conv=%s msg=%s', clientId, contactId, convId, msg.rows[0].id);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ERRO:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();

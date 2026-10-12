/**
 * Cria tabela luna_chat_sessions no PostgreSQL
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool } = require('../db');

async function main() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS luna_chat_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT 'Nova conversa',
        mode TEXT NOT NULL DEFAULT 'thinking',
        messages JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_luna_sessions_user 
      ON luna_chat_sessions(user_id);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_luna_sessions_updated 
      ON luna_chat_sessions(updated_at DESC);
    `);
    
    console.log('✅ Tabela luna_chat_sessions criada/atualizada com sucesso');
  } catch (err) {
    console.error('❌ Erro:', err.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

main();

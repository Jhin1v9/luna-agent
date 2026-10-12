const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const SESSIONS_DIR = path.join(require('os').homedir(), '.luna', 'sessions');

async function query(sql, params) {
  const client = await pool.connect();
  try { const r = await client.query(sql, params); return r.rows; } finally { client.release(); }
}
async function run(sql, params) {
  const client = await pool.connect();
  try { const r = await client.query(sql, params); return r.rows[0] || null; } finally { client.release(); }
}

function parseJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function parseState(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

(async () => {
  const dirs = fs.readdirSync(SESSIONS_DIR).filter(d => fs.statSync(path.join(SESSIONS_DIR, d)).isDirectory() && fs.existsSync(path.join(SESSIONS_DIR, d, 'context.jsonl')));
  console.log('Sessoes encontradas:', dirs.length);
  let migrated = 0, skipped = 0, errors = 0;

  for (const sessionId of dirs) {
    const dir = path.join(SESSIONS_DIR, sessionId);
    const messages = parseJsonl(path.join(dir, 'context.jsonl'));
    const state = parseState(path.join(dir, 'state.json'));
    if (messages.length === 0) { skipped++; continue; }

    const existing = await query('SELECT id FROM luna_chat_sessions WHERE id = $1', [sessionId]);
    if (existing.length > 0) { console.log('  - ja existe:', sessionId); skipped++; continue; }

    const title = state?.title || 'Nova Sessão';
    const mode = state?.mode || 'instant';
    const persona = state?.persona || 'default';
    const createdAt = state?.createdAt || messages[0]?.timestamp || new Date().toISOString();
    const updatedAt = messages[messages.length - 1]?.timestamp || state?.lastAccessedAt || createdAt;

    try {
      await run(
        'INSERT INTO luna_chat_sessions (id, user_id, title, mode, persona, messages, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)',
        [sessionId, 'abner', title, mode, persona, JSON.stringify(messages), createdAt, updatedAt]
      );
      console.log('  + migrada:', sessionId, '-', messages.length, 'msgs');
      migrated++;
    } catch (e) {
      console.error('  ! ERRO', sessionId, e.message);
      errors++;
    }
  }
  console.log('Migradas:', migrated, 'Ignoradas:', skipped, 'Erros:', errors);
  await pool.end();
})();

/**
 * NEXO Dashboard — PostgreSQL Database Module
 * Uses node-postgres with connection pooling.
 */
const { Pool } = require('pg');

function isValidPostgresUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return !!(u.hostname && u.protocol && (u.protocol === 'postgres:' || u.protocol === 'postgresql:'));
  } catch {
    return false;
  }
}

const isRender = process.env.DATABASE_URL?.includes('render.com');
const isNeon = process.env.DATABASE_URL?.includes('neon.tech');
const DB_ENABLED = isValidPostgresUrl(process.env.DATABASE_URL);

if (!DB_ENABLED) {
  console.warn('[DB] DATABASE_URL not configured or invalid — PostgreSQL operations disabled (JSON fallback active).');
}

const pool = DB_ENABLED ? new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
  max: 5,
  ssl: (isNeon || isRender)
    ? { rejectUnauthorized: false }
    : false,
  // Render/Neon require short statement_timeout to avoid hanging on unreachable hosts.
  options: (isNeon || isRender) ? '-c statement_timeout=5000' : '',
}) : null;

// Log connection events
if (pool) {
  pool.on('error', (err) => {
    console.error('PostgreSQL pool error:', err.message);
  });
}

/**
 * Retry wrapper for Neon PostgreSQL instability (ETIMEDOUT / ENETUNREACH)
 */
async function _withRetry(fn, operationName = 'db') {
  if (!DB_ENABLED) {
    throw new Error('DATABASE_URL not configured or invalid');
  }
  const maxRetries = 3;
  const baseDelay = 500; // ms
  let lastErr;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isConnectionError =
        err.code === 'ETIMEDOUT' ||
        err.code === 'ENETUNREACH' ||
        err.code === 'ECONNREFUSED' ||
        err.code === 'ECONNRESET' ||
        err.message?.includes('timeout') ||
        err.message?.includes(' Neon ');

      if (!isConnectionError || attempt >= maxRetries) {
        throw err;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(`[DB] ${operationName} failed (attempt ${attempt + 1}/${maxRetries + 1}): ${err.message}. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw lastErr;
}

/**
 * Execute a query and return all rows.
 */
async function query(sql, params = []) {
  return _withRetry(async () => {
    const client = await pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows;
    } finally {
      client.release();
    }
  }, 'query');
}

/**
 * Execute a query and return the first row (or null).
 */
async function get(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

/**
 * Execute an INSERT/UPDATE/DELETE and return the first row (if RETURNING).
 */
async function run(sql, params = []) {
  return _withRetry(async () => {
    const client = await pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }, 'run');
}

/**
 * Execute multiple statements in a single transaction.
 * @param {Function} fn - async (client) => { ... }
 */
async function transaction(fn) {
  if (!DB_ENABLED) {
    throw new Error('DATABASE_URL not configured or invalid');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Check if the database is connected.
 */
async function healthCheck() {
  try {
    const row = await get('SELECT NOW() as now');
    return { ok: true, now: row?.now };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  pool,
  query,
  get,
  run,
  transaction,
  healthCheck,
  DB_ENABLED,
};

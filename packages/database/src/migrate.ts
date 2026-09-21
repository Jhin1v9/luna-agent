import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadDotEnv, loadConfig } from '@luna/shared';
import { createLogger } from '@luna/logging';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const log = createLogger({ name: 'db-migrate' });

/**
 * Migrator simples: aplica arquivos .sql de migrations/ em ordem lexicográfica,
 * registrando cada um em schema_migrations (uma única vez).
 */
export async function migrate(databaseUrl: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const appliedRows = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations',
    );
    const applied = new Set(appliedRows.rows.map((r) => r.version));

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const newlyApplied: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      log.info({ migration: file }, 'applying migration');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
      newlyApplied.push(file);
      log.info({ migration: file }, 'migration applied');
    }

    return newlyApplied;
  } finally {
    await client.end();
  }
}

// Execução direta: pnpm --filter @luna/database migrate
const isMain =
  !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isMain) {
  loadDotEnv();
  const config = loadConfig();
  migrate(config.DATABASE_URL)
    .then((applied) => {
      log.info({ count: applied.length, migrations: applied }, 'migrations done');
      process.exit(0);
    })
    .catch((err) => {
      log.error({ err }, 'migration failed');
      process.exit(1);
    });
}

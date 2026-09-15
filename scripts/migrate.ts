/**
 * Migration runner. Applies every db/migrations/*.sql not yet recorded in
 * schema_migrations, each inside its own transaction.
 *
 *   npm run db:migrate            apply pending migrations
 *   npm run db:migrate -- --reset drop the public schema first, then apply all
 */
import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');

async function main() {
  const reset = process.argv.includes('--reset');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  if (reset) {
    console.log('! dropping and recreating schema "public"');
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  const applied = new Set(
    (await client.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map(
      (r) => r.filename,
    ),
  );

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`  applied ${file}`);
      count++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  FAILED  ${file}`);
      throw err;
    }
  }

  console.log(count === 0 ? 'Already up to date.' : `Applied ${count} migration(s).`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

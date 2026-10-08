/**
 * Creates the test database if needed and rebuilds it from the migrations, so
 * every test run starts from exactly the schema a fresh install gets.
 */
import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { testDatabaseUrl } from '../tests/env';

async function main() {
  const testUrl = new URL(testDatabaseUrl());
  const dbName = testUrl.pathname.slice(1);
  if (!/^[a-z0-9_]+$/i.test(dbName)) throw new Error(`Refusing odd database name: ${dbName}`);
  if (!dbName.endsWith('_test')) throw new Error('The test database name must end in _test.');

  const admin = new URL(testUrl.toString());
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount === 0) {
    await client.query(`CREATE DATABASE "${dbName}"`);   // name validated above; identifiers cannot be parameterised
    console.log(`created ${dbName}`);
  }
  await client.end();

  execSync('npx tsx scripts/migrate.ts --reset', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
  });
}

main().catch((e) => { console.error(e); process.exit(1); });

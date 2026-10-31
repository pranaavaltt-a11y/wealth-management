/**
 * Database restore (issue #29).
 *
 * Replaces the current data with a backup's. This is destructive — it
 * TRUNCATEs every data table first — so it refuses to run without --yes.
 *
 *   npm run db:restore -- --yes                 restore the newest backup
 *   npm run db:restore -- --yes path/to/backup-20261031-120000.json
 *   npm run db:restore -- --yes --dir /some/where
 *
 * Environment override: BACKUP_DIR.
 */
import 'dotenv/config';
import { pool, withTransaction } from '../src/lib/db/postgres';
import {
  readBackup, latestBackup, restoreBackup, restoreMongo, schemaCompatibility,
  DEFAULT_BACKUP_DIR,
} from '../src/lib/services/backup-service';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** The first bare argument (not a flag and not a flag's value). */
function positional(): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { i++; continue; } // skip flag + its value
    return args[i];
  }
  return undefined;
}

async function main() {
  const dir = flag('dir') ?? process.env.BACKUP_DIR ?? DEFAULT_BACKUP_DIR;
  const path = positional() ?? latestBackup(dir);
  if (!path) throw new Error(`No backup given and none found in ${dir}.`);

  const backup = readBackup(path);
  const targetDb = (await pool.query<{ d: string }>('SELECT current_database() AS d')).rows[0].d;

  console.log(`Restore source: ${path}`);
  console.log(`  taken:   ${backup.createdAt}  (from database "${backup.database}")`);
  console.log(`  target:  database "${targetDb}"  ← will be OVERWRITTEN`);

  const compat = await schemaCompatibility(pool, backup);
  if (compat.missing.length) {
    throw new Error(
      `Target database is missing migration(s) this backup needs: ${compat.missing.join(', ')}.\n` +
      `Run "npm run db:migrate" against the target first.`,
    );
  }
  if (compat.extra.length) {
    console.log(`  note:    target has newer migration(s) not in the backup: ${compat.extra.join(', ')}`);
  }

  if (!process.argv.includes('--yes')) {
    console.log('\nRefusing to overwrite without confirmation. Re-run with --yes to proceed.');
    await pool.end();
    return;
  }

  const stats = await withTransaction((client) => restoreBackup(client, backup));
  const mongo = await restoreMongo(backup);

  console.log('\nRestored:');
  for (const table of backup.tableOrder) {
    console.log(`  ${table.padEnd(22)} ${String(stats.tables[table] ?? 0).padStart(7)} rows`);
  }
  if (mongo) {
    for (const [name, n] of Object.entries(mongo)) {
      console.log(`  mongo:${name.padEnd(16)} ${String(n).padStart(7)} docs`);
    }
  } else if (backup.mongo) {
    console.log('  (MongoDB data in backup skipped — Mongo not configured here)');
  }

  console.log('\nRestore complete.');
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});

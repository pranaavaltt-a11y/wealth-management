/**
 * Database backup (issue #29).
 *
 * Dumps every Postgres data table — and the Mongo collections when configured —
 * to one timestamped JSON file under backups/, then prunes old files down to
 * the retention limit.
 *
 *   npm run db:backup
 *   npm run db:backup -- --dir /some/where --keep 30
 *
 * Environment overrides: BACKUP_DIR, BACKUP_RETENTION.
 * Backups are git-ignored and must never be committed (they contain real data).
 */
import 'dotenv/config';
import { pool } from '../src/lib/db/postgres';
import {
  createBackup, writeBackup, applyRetention,
  DEFAULT_BACKUP_DIR, DEFAULT_RETENTION,
} from '../src/lib/services/backup-service';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const dir = flag('dir') ?? process.env.BACKUP_DIR ?? DEFAULT_BACKUP_DIR;
  const keep = Number(flag('keep') ?? process.env.BACKUP_RETENTION ?? DEFAULT_RETENTION);

  const backup = await createBackup(pool);
  const path = writeBackup(backup, dir);

  console.log(`Backup written: ${path}`);
  const total = Object.values(backup.counts).reduce((a, b) => a + b, 0);
  for (const table of backup.tableOrder) {
    console.log(`  ${table.padEnd(22)} ${String(backup.counts[table]).padStart(7)} rows`);
  }
  console.log(`  ${'TOTAL'.padEnd(22)} ${String(total).padStart(7)} rows`);
  if (backup.mongo) {
    const docs = Object.values(backup.mongo).reduce((a, b) => a + b.length, 0);
    console.log(`  (+ ${docs} MongoDB document(s))`);
  }

  const pruned = applyRetention(dir, keep);
  if (pruned.length) {
    console.log(`Retention: kept ${keep}, removed ${pruned.length} older backup(s): ${pruned.join(', ')}`);
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});

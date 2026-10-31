import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pool, makeUser, makeLoan, makeAsset, payFirst, one } from '../helpers';
import { withTransaction } from '../../src/lib/db/postgres';
import {
  createBackup, restoreBackup, writeBackup, readBackup, listBackups, latestBackup,
  applyRetention, orderByDependency, schemaCompatibility, backupFilename,
  BACKUP_FORMAT, BACKUP_VERSION,
} from '../../src/lib/services/backup-service';

after(() => pool.end());

/**
 * These tests TRUNCATE and reload every table, so they must own the database
 * for the duration. The db suite runs files serially (--test-concurrency=1),
 * and this file sorts first, so it starts from the freshly-migrated schema.
 */

describe('backup-service: dependency ordering (pure)', () => {
  it('places every parent before its children', () => {
    const tables = ['emi_schedule', 'users', 'transactions', 'loans', 'assets'];
    const edges: [string, string][] = [
      ['assets', 'users'], ['loans', 'users'], ['emi_schedule', 'loans'],
      ['transactions', 'users'], ['transactions', 'assets'], ['transactions', 'loans'],
    ];
    const order = orderByDependency(tables, edges);
    const at = (t: string) => order.indexOf(t);
    assert.ok(at('users') < at('assets'), 'users before assets');
    assert.ok(at('users') < at('loans'), 'users before loans');
    assert.ok(at('loans') < at('emi_schedule'), 'loans before emi_schedule');
    assert.ok(at('assets') < at('transactions'), 'assets before transactions');
    assert.equal(new Set(order).size, tables.length, 'every table appears once');
  });

  it('is deterministic and ignores self-referential edges (users.advisor_id)', () => {
    const tables = ['users', 'assets'];
    const a = orderByDependency(tables, [['users', 'users'], ['assets', 'users']]);
    const b = orderByDependency(tables, [['assets', 'users'], ['users', 'users']]);
    assert.deepEqual(a, b);
    assert.deepEqual(a, ['users', 'assets']);
  });

  it('does not drop tables caught in a cycle', () => {
    const order = orderByDependency(['a', 'b'], [['a', 'b'], ['b', 'a']]);
    assert.deepEqual([...order].sort(), ['a', 'b']);
  });
});

describe('backup-service: backup shape', () => {
  it('captures data, excludes generated columns, and stays self-describing', async () => {
    const u = await makeUser();
    await makeAsset(u, 500_000, 'equity');
    const loan = await makeLoan(u, { principal: 800_000, tenure: 24 });
    await payFirst(loan, 3);

    const backup = await createBackup(pool);

    assert.equal(backup.format, BACKUP_FORMAT);
    assert.equal(backup.version, BACKUP_VERSION);
    assert.ok(backup.schemaMigrations.length >= 8, 'records applied migrations');
    assert.ok(backup.tableOrder.indexOf('users') < backup.tableOrder.indexOf('assets'));

    // The generated tsvector must never be dumped (it cannot be written back).
    assert.ok(!backup.tables.transactions.columns.includes('search_vector'));
    assert.ok(backup.tables.users.columns.includes('email'));
    assert.equal(backup.counts.users, backup.tables.users.rows.length);
  });
});

describe('backup-service: restore round-trip', () => {
  it('rebuilds the exact database after a full wipe', async () => {
    // Build a spread of data including a jsonb-bearing credit score.
    const u = await makeUser();
    await makeAsset(u, 1_250_000, 'property', 'illiquid');
    const loan = await makeLoan(u, { principal: 2_000_000, rate: 8.5, tenure: 60 });
    await payFirst(loan, 12);
    await one('SELECT fn_compute_credit_score($1)', [u]); // writes credit_score_history.factors_json (jsonb)

    const before = await createBackup(pool);
    assert.ok(before.counts.users > 0 && before.counts.credit_score_history > 0);

    // Destroy everything a restore is supposed to bring back.
    await pool.query('DELETE FROM users');
    assert.equal((await one<{ n: number }>('SELECT count(*)::int n FROM users')).n, 0);
    assert.equal((await one<{ n: number }>('SELECT count(*)::int n FROM transactions')).n, 0);

    await withTransaction((client) => restoreBackup(client, before));

    const after = await createBackup(pool);
    // createdAt differs; the data must not.
    assert.deepEqual(after.counts, before.counts, 'row counts match');
    assert.deepEqual(after.tables, before.tables, 'every row is byte-identical, jsonb scale included');
  });

  it('resets identity sequences so new inserts do not collide', async () => {
    const backup = await createBackup(pool);
    await pool.query('DELETE FROM users');
    await withTransaction((client) => restoreBackup(client, backup));

    // The next generated id must be MAX(id)+1, not a value that already exists.
    const maxId = (await one<{ m: number }>('SELECT COALESCE(MAX(id),0)::int m FROM users')).m;
    const fresh = await makeUser();
    assert.ok(fresh > maxId, `new id ${fresh} should exceed restored max ${maxId}`);
  });
});

describe('backup-service: schema compatibility', () => {
  it('reports no missing migrations against the database it was taken from', async () => {
    const backup = await createBackup(pool);
    const { missing } = await schemaCompatibility(pool, backup);
    assert.deepEqual(missing, []);
  });

  it('flags a migration the target has not applied', async () => {
    const backup = await createBackup(pool);
    backup.schemaMigrations = [...backup.schemaMigrations, '999_from_the_future.sql'];
    const { missing } = await schemaCompatibility(pool, backup);
    assert.deepEqual(missing, ['999_from_the_future.sql']);
  });
});

describe('backup-service: files & retention', () => {
  let dir: string;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'ww-backup-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('writes, lists and reads a backup file', async () => {
    const backup = await createBackup(pool);
    const path = writeBackup(backup, dir);
    assert.ok(path.endsWith('.json'));
    assert.equal(listBackups(dir).length, 1);
    assert.equal(latestBackup(dir), path);

    const read = readBackup(path);
    assert.deepEqual(read.counts, backup.counts);
  });

  it('rejects a file that is not a WealthWise backup', () => {
    const bad = join(dir, 'backup-00000000-000000-000.json');
    writeFileSync(bad, JSON.stringify({ format: 'something-else' }));
    assert.throws(() => readBackup(bad), /Not a WealthWise backup/);
  });

  it('keeps the N most recent and prunes older ones, newest-last by name', () => {
    const fresh = mkdtempSync(join(tmpdir(), 'ww-ret-'));
    try {
      // Hand-made filenames with a clear chronological order.
      const names = [
        'backup-20260101-000000-000.json',
        'backup-20260102-000000-000.json',
        'backup-20260103-000000-000.json',
        'backup-20260104-000000-000.json',
      ];
      for (const n of names) writeFileSync(join(fresh, n), '{"format":"wealthwise-backup"}');

      const removed = applyRetention(fresh, 2);
      assert.deepEqual(removed, names.slice(0, 2), 'removes the two oldest');
      assert.deepEqual(listBackups(fresh), names.slice(2), 'keeps the two newest');

      // keep <= 0 means "keep everything" — never a silent wipe.
      assert.deepEqual(applyRetention(fresh, 0), []);
      assert.equal(listBackups(fresh).length, 2);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  it('generates sortable, chronological filenames', () => {
    const earlier = backupFilename(new Date('2026-01-01T10:00:00.100Z'));
    const later = backupFilename(new Date('2026-01-01T10:00:00.900Z'));
    assert.ok(earlier < later, `${earlier} should sort before ${later}`);
    assert.match(earlier, /^backup-\d{8}-\d{6}-\d{3}\.json$/);
  });
});

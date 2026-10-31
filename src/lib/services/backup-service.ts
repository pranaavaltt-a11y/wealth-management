import { readdirSync, writeFileSync, readFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { tryGetDb, isMongoConfigured, COLLECTIONS } from '@/lib/db/mongo';

/**
 * Database backup & restore (issue #29).
 *
 * A backup is a single self-describing JSON file: the full contents of every
 * Postgres data table plus, when MongoDB is configured, its document
 * collections. One file is enough to rebuild the whole system from an empty
 * (but migrated) database, which is what a restore drill actually needs.
 *
 * Why JSON and not pg_dump? Three reasons that matter here:
 *   - it is portable — restore needs only a node-postgres connection, no
 *     matching pg_dump/pg_restore binaries on the box;
 *   - it also captures the Mongo half, which pg_dump cannot see; and
 *   - it is inspectable in a review or a test without a running server.
 *
 * The table list and column list are read from the catalog at backup time, so
 * a new migration that adds a table or column is picked up automatically — the
 * backup never silently drops data it does not know about.
 */

export const BACKUP_FORMAT = 'wealthwise-backup';
export const BACKUP_VERSION = 1;

/** Where backups are written, and how many to keep, unless overridden. */
export const DEFAULT_BACKUP_DIR = join(process.cwd(), 'backups');
export const DEFAULT_RETENTION = 10;
const FILE_PREFIX = 'backup-';
const FILE_SUFFIX = '.json';

/** Bookkeeping table — its contents are compared, never reloaded. */
const SCHEMA_TABLE = 'schema_migrations';

/** Minimal shape shared by Pool and PoolClient, so callers pass either. */
type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

interface ColumnMeta {
  name: string;
  /** information_schema.columns.data_type, e.g. 'jsonb', 'bigint'. */
  dataType: string;
  /** GENERATED ALWAYS AS (...) — must never be written on restore. */
  generated: boolean;
  /** GENERATED ... AS IDENTITY — needs OVERRIDING SYSTEM VALUE to preserve ids. */
  identity: boolean;
}

export interface TableDump {
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  database: string | null;
  /** Applied migration filenames, for a compatibility check on restore. */
  schemaMigrations: string[];
  /** Dependency-ordered: parents before children. */
  tableOrder: string[];
  tables: Record<string, TableDump>;
  mongo: Record<string, Record<string, unknown>[]> | null;
  counts: Record<string, number>;
}

export interface RestoreStats {
  tables: Record<string, number>;
  mongo: Record<string, number> | null;
  skippedMongo: boolean;
}

// --------------------------------------------------------------- catalog reads

async function listDataTables(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND table_name <> $1
      ORDER BY table_name`,
    [SCHEMA_TABLE],
  );
  return rows.map((r) => r.table_name);
}

async function columnsOf(db: Queryable, table: string): Promise<ColumnMeta[]> {
  const { rows } = await db.query<{
    column_name: string; data_type: string; is_generated: string; is_identity: string;
  }>(
    `SELECT column_name, data_type, is_generated, is_identity
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((r) => ({
    name: r.column_name,
    dataType: r.data_type,
    generated: r.is_generated === 'ALWAYS',
    identity: r.is_identity === 'YES',
  }));
}

/** child -> parent foreign-key edges within public (self-edges excluded). */
async function fkEdges(db: Queryable): Promise<[string, string][]> {
  const { rows } = await db.query<{ child: string; parent: string }>(
    `SELECT c.conrelid::regclass::text AS child,
            c.confrelid::regclass::text AS parent
       FROM pg_constraint c
      WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`,
  );
  return rows
    .map((r) => [stripSchema(r.child), stripSchema(r.parent)] as [string, string])
    .filter(([child, parent]) => child !== parent);
}

/**
 * How a column is read for the dump. Some types are cast to text so the exact
 * stored value survives the trip through JavaScript:
 *   - timestamp/time: a JS Date holds only milliseconds, so microseconds would
 *     be silently dropped on every round-trip;
 *   - json/jsonb: Postgres stores jsonb numbers as NUMERIC and keeps their
 *     scale (39.0, 1.000), but a JS number does not — casting to text preserves
 *     the canonical jsonb form verbatim.
 * NUMERIC and DATE already arrive as exact strings, so they need no cast.
 */
function selectExpr(col: ColumnMeta): string {
  const q = quoteIdent(col.name);
  const t = col.dataType;
  const asText = t.startsWith('timestamp') || t.startsWith('time ') || t === 'json' || t === 'jsonb';
  return asText ? `${q}::text AS ${q}` : q;
}

function stripSchema(ident: string): string {
  // regclass may quote or schema-qualify ("public"."users"); keep the bare name.
  const last = ident.split('.').pop() ?? ident;
  return last.replace(/"/g, '');
}

/**
 * Kahn topological sort so parents are dumped (and restored) before children.
 * Ties broken alphabetically for a stable, reviewable order. Any table caught
 * in a cycle is appended at the end rather than dropped.
 */
export function orderByDependency(tables: string[], edges: [string, string][]): string[] {
  const set = new Set(tables);
  const indeg = new Map<string, number>(tables.map((t) => [t, 0]));
  const children = new Map<string, string[]>(tables.map((t) => [t, []]));
  for (const [child, parent] of edges) {
    if (!set.has(child) || !set.has(parent)) continue;
    children.get(parent)!.push(child);
    indeg.set(child, (indeg.get(child) ?? 0) + 1);
  }
  const ready = tables.filter((t) => indeg.get(t) === 0).sort();
  const out: string[] = [];
  while (ready.length) {
    const t = ready.shift()!;
    out.push(t);
    for (const child of children.get(t)!.sort()) {
      indeg.set(child, indeg.get(child)! - 1);
      if (indeg.get(child) === 0) {
        ready.push(child);
        ready.sort();
      }
    }
  }
  for (const t of tables) if (!out.includes(t)) out.push(t); // cycle fallback
  return out;
}

// ------------------------------------------------------------------- the dump

/** Read every table and build an in-memory backup. Does not touch disk. */
export async function createBackup(db: Queryable): Promise<BackupFile> {
  const dataTables = await listDataTables(db);
  const order = orderByDependency(dataTables, await fkEdges(db));

  const tables: Record<string, TableDump> = {};
  const counts: Record<string, number> = {};
  for (const table of order) {
    // Generated columns (e.g. transactions.search_vector) are derived and
    // cannot be written back, so they are left out of the dump entirely.
    const cols = (await columnsOf(db, table)).filter((c) => !c.generated);
    const names = cols.map((c) => c.name);
    const selectList = cols.map(selectExpr).join(', ');
    const { rows } = await db.query(`SELECT ${selectList} FROM ${quoteIdent(table)} ORDER BY 1`);
    tables[table] = { columns: names, rows };
    counts[table] = rows.length;
  }

  const schemaMigrations = (
    await db.query<{ filename: string }>(
      `SELECT filename FROM ${quoteIdent(SCHEMA_TABLE)} ORDER BY filename`,
    )
  ).rows.map((r) => r.filename);

  const dbName = (await db.query<{ current_database: string }>('SELECT current_database()'))
    .rows[0]?.current_database ?? null;

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    database: dbName,
    schemaMigrations,
    tableOrder: order,
    tables,
    mongo: await dumpMongo(),
    counts,
  };
}

async function dumpMongo(): Promise<BackupFile['mongo']> {
  if (!isMongoConfigured()) return null;
  const db = await tryGetDb();
  if (!db) return null;
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const name of Object.values(COLLECTIONS)) {
    out[name] = await db.collection(name).find({}).toArray();
  }
  return out;
}

// ------------------------------------------------------------------- the files

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/**
 * Timestamped filename: backup-YYYYMMDD-HHMMSS-mmm.json
 *
 * Lexical order equals chronological order, which is what listBackups and
 * retention rely on. Milliseconds are included so backups taken seconds — or
 * the same second — apart never collide in normal use.
 */
export function backupFilename(when: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const s =
    `${when.getFullYear()}${p(when.getMonth() + 1)}${p(when.getDate())}` +
    `-${p(when.getHours())}${p(when.getMinutes())}${p(when.getSeconds())}` +
    `-${p(when.getMilliseconds(), 3)}`;
  return `${FILE_PREFIX}${s}${FILE_SUFFIX}`;
}

/** Write the backup to `dir`, returning the absolute path written. */
export function writeBackup(backup: BackupFile, dir: string, filename?: string): string {
  ensureDir(dir);
  const name = filename ?? uniqueName(dir, backupFilename(new Date(backup.createdAt)));
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(backup, null, 2) + '\n', 'utf8');
  return path;
}

/** Avoid clobbering a backup taken in the same second: backup-….json → …-2.json */
function uniqueName(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name;
  const base = name.slice(0, -FILE_SUFFIX.length);
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}${FILE_SUFFIX}`;
    if (!existsSync(join(dir, candidate))) return candidate;
  }
}

export function listBackups(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(FILE_PREFIX) && f.endsWith(FILE_SUFFIX))
    .sort(); // timestamp in the name → lexical order is chronological
}

export function latestBackup(dir: string): string | null {
  const files = listBackups(dir);
  return files.length ? join(dir, files[files.length - 1]) : null;
}

export function readBackup(path: string): BackupFile {
  const data = JSON.parse(readFileSync(path, 'utf8')) as BackupFile;
  if (data.format !== BACKUP_FORMAT) {
    throw new Error(`Not a WealthWise backup (format="${(data as { format?: string }).format}").`);
  }
  if (data.version > BACKUP_VERSION) {
    throw new Error(`Backup version ${data.version} is newer than this tool (v${BACKUP_VERSION}).`);
  }
  return data;
}

/**
 * Delete the oldest backups, keeping the `keep` most recent. Returns the names
 * removed. `keep <= 0` is treated as "keep everything" — retention is opt-in,
 * never a way to accidentally wipe the directory.
 */
export function applyRetention(dir: string, keep: number): string[] {
  if (keep <= 0) return [];
  const files = listBackups(dir);
  if (files.length <= keep) return [];
  const doomed = files.slice(0, files.length - keep);
  for (const f of doomed) unlinkSync(join(dir, f));
  return doomed;
}

/**
 * Compare the migrations a backup was taken against with those applied to the
 * target database. `missing` are migrations the backup expects but the target
 * has not applied (restoring would load data for tables/columns that may not
 * exist — unsafe). `extra` are migrations the target has beyond the backup
 * (usually fine). An empty `missing` means the restore is safe to attempt.
 */
export async function schemaCompatibility(
  db: Queryable,
  backup: BackupFile,
): Promise<{ missing: string[]; extra: string[] }> {
  const applied = new Set(
    (
      await db.query<{ filename: string }>(
        `SELECT filename FROM ${quoteIdent(SCHEMA_TABLE)}`,
      )
    ).rows.map((r) => r.filename),
  );
  const inBackup = new Set(backup.schemaMigrations);
  return {
    missing: backup.schemaMigrations.filter((m) => !applied.has(m)),
    extra: [...applied].filter((m) => !inBackup.has(m)).sort(),
  };
}

// ---------------------------------------------------------------- the restore

/**
 * Replace the live data with the backup's, inside one transaction.
 *
 * Triggers and FK checks are suspended for the load (session_replication_role
 * = replica) for two reasons: the net-worth/credit-score triggers would
 * otherwise recompute rows we are trying to restore verbatim, and FK order
 * (including users.advisor_id, which is self-referential) stops mattering. The
 * setting is transaction-local, so it reverts on COMMIT/ROLLBACK and never
 * leaks onto a pooled connection.
 *
 * The caller provides a transactional client (see withTransaction).
 */
export async function restoreBackup(client: Queryable, backup: BackupFile): Promise<RestoreStats> {
  await client.query("SET LOCAL session_replication_role = 'replica'");

  const order = backup.tableOrder.filter((t) => backup.tables[t]);
  if (order.length) {
    const targets = order.map(quoteIdent).join(', ');
    // Children first for truncation is unnecessary with CASCADE, but RESTART
    // IDENTITY resets every sequence so restored ids are authoritative.
    await client.query(`TRUNCATE ${targets} RESTART IDENTITY CASCADE`);
  }

  const stats: Record<string, number> = {};
  for (const table of order) {
    const dump = backup.tables[table];
    stats[table] = await loadTable(client, table, dump);
  }

  // Sequences were reset by TRUNCATE; advance each past the ids we inserted.
  for (const table of order) await resyncIdentity(client, table, backup.tables[table].columns);

  return { tables: stats, mongo: null, skippedMongo: true };
}

/**
 * Restore the Mongo half, if the backup carries one and Mongo is configured.
 * Each collection is dropped and reloaded. Returns per-collection counts, or
 * null when there was nothing to do (no mongo in the backup, or no connection).
 */
export async function restoreMongo(backup: BackupFile): Promise<Record<string, number> | null> {
  if (!backup.mongo || !isMongoConfigured()) return null;
  const db = await tryGetDb();
  if (!db) return null;
  const counts: Record<string, number> = {};
  for (const [name, docs] of Object.entries(backup.mongo)) {
    await db.collection(name).deleteMany({});
    if (docs.length) await db.collection(name).insertMany(docs as Record<string, unknown>[]);
    counts[name] = docs.length;
  }
  return counts;
}

async function loadTable(client: Queryable, table: string, dump: TableDump): Promise<number> {
  if (dump.rows.length === 0) return 0;

  const meta = await columnsOf(client, table);
  const byName = new Map(meta.map((m) => [m.name, m]));
  // Only load columns that still exist and are writable.
  const cols = dump.columns.filter((c) => byName.has(c) && !byName.get(c)!.generated);
  const hasIdentity = cols.some((c) => byName.get(c)!.identity);
  const colList = cols.map(quoteIdent).join(', ');
  const overriding = hasIdentity ? 'OVERRIDING SYSTEM VALUE ' : '';

  // Batch rows into multi-row INSERTs to keep the round-trips sane on big tables.
  const BATCH = 500;
  let loaded = 0;
  for (let i = 0; i < dump.rows.length; i += BATCH) {
    const slice = dump.rows.slice(i, i + BATCH);
    const values: unknown[] = [];
    const tuples: string[] = [];
    for (const row of slice) {
      const placeholders = cols.map((c) => {
        values.push(encodeValue(row[c], byName.get(c)!.dataType));
        return `$${values.length}`;
      });
      tuples.push(`(${placeholders.join(', ')})`);
    }
    await client.query(
      `INSERT INTO ${quoteIdent(table)} (${colList}) ${overriding}VALUES ${tuples.join(', ')}`,
      values,
    );
    loaded += slice.length;
  }
  return loaded;
}

/** json/jsonb must be sent as a string; everything else round-trips as-is. */
function encodeValue(value: unknown, dataType: string): unknown {
  if (value === null || value === undefined) return null;
  // The dump stores json/jsonb as its canonical text (see selectExpr), so it is
  // already a string here — pass it straight through. Fall back to stringifying
  // in case a backup carried a nested object (older dump, or a hand-built one).
  if (dataType === 'json' || dataType === 'jsonb') {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  return value;
}

async function resyncIdentity(client: Queryable, table: string, columns: string[]): Promise<void> {
  const meta = await columnsOf(client, table);
  for (const col of meta) {
    if (!col.identity || !columns.includes(col.name)) continue;
    // setval(seq, MAX(id)) so the next generated id is MAX+1; false => don't skip it when table is empty.
    await client.query(
      `SELECT setval(
         pg_get_serial_sequence($1, $2),
         COALESCE((SELECT MAX(${quoteIdent(col.name)}) FROM ${quoteIdent(table)}), 1),
         (SELECT COUNT(*) FROM ${quoteIdent(table)}) > 0
       )`,
      [table, col.name],
    );
  }
}

/** Double-quote an identifier that we built from catalog names (defence in depth). */
function quoteIdent(ident: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(ident)) {
    throw new Error(`Refusing unexpected identifier: ${ident}`);
  }
  return `"${ident}"`;
}

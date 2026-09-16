import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';

/**
 * node-postgres type parsers, set once at module load.
 *
 * INT8 (bigint) arrives as a string by default because a 64-bit integer can
 * exceed Number.MAX_SAFE_INTEGER. Our ids and counts never will, and having
 * them as strings leaks into every JSON response, so parse them as numbers.
 *
 * DATE arrives as a JS Date, which JSON.stringify turns into a full UTC
 * timestamp — that shifts the day backwards for anyone east of UTC and breaks
 * <input type="date"> round-tripping. A DATE has no time or zone, so keep it
 * as the plain 'YYYY-MM-DD' string Postgres sent.
 */
types.setTypeParser(types.builtins.INT8, (v) => Number.parseInt(v, 10));
types.setTypeParser(types.builtins.DATE, (v) => v);

/**
 * Single shared connection pool.
 *
 * Next.js dev mode re-evaluates modules on every hot reload, which would leak a
 * new pool each time — so the pool is stashed on globalThis in development.
 */
const globalForPg = globalThis as unknown as { __wwPool?: Pool };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  }
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export const pool: Pool = globalForPg.__wwPool ?? createPool();
if (process.env.NODE_ENV !== 'production') globalForPg.__wwPool = pool;

/** Run a parameterised query. Never interpolate user input into `text`. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

/** Exactly-one-row helper for lookups by primary key. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Run `fn` inside a single BEGIN/COMMIT. Rolls back on any throw.
 * Used wherever multiple statements must land atomically — creating a loan and
 * its EMI schedule, or a bulk CSV import.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
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

/** Postgres NUMERIC arrives as a string (to preserve precision). Normalise it. */
export function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number.parseFloat(value);
}

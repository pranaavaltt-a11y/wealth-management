import { MongoClient, type Db } from 'mongodb';

/**
 * MongoDB holds only the schema-flexible half of the system:
 *   documents               — uploaded receipts / loan papers (Phase 3)
 *   asset_valuation_history — per-asset-type metadata varies wildly
 *   raw_imports             — bank CSV rows as received, before normalisation
 *   news_articles           — cached third-party feed (Phase 4)
 *
 * Everything transactional stays in Postgres. Mongo is optional: if MONGODB_URI
 * is unset the app runs with those features disabled rather than crashing, which
 * keeps Phase 1 usable on a Postgres-only machine.
 */
const globalForMongo = globalThis as unknown as {
  __wwMongo?: Promise<MongoClient>;
  __wwMongoDownUntil?: number;
};

/** How long to stop attempting connections after a failure. */
const RETRY_COOLDOWN_MS = 60_000;

export function isMongoConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI);
}

function connect(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set.');
  return new MongoClient(uri, { serverSelectionTimeoutMS: 3_000 }).connect();
}

export async function getDb(): Promise<Db> {
  const client = await (globalForMongo.__wwMongo ??= connect());
  return client.db(process.env.MONGODB_DB ?? 'wealthwise');
}

/**
 * Returns null instead of throwing when Mongo is absent — callers degrade.
 *
 * A failed connection is remembered for a minute. Without that, every asset
 * write would pay the full serverSelectionTimeoutMS before giving up, turning a
 * missing optional database into a three-second stall on each request.
 */
export async function tryGetDb(): Promise<Db | null> {
  if (!isMongoConfigured()) return null;
  if (globalForMongo.__wwMongoDownUntil && Date.now() < globalForMongo.__wwMongoDownUntil) {
    return null;
  }
  try {
    const db = await getDb();
    globalForMongo.__wwMongoDownUntil = undefined;
    return db;
  } catch {
    globalForMongo.__wwMongoDownUntil = Date.now() + RETRY_COOLDOWN_MS;
    globalForMongo.__wwMongo = undefined;   // let the next attempt reconnect
    return null;
  }
}

export const COLLECTIONS = {
  documents: 'documents',
  assetValuationHistory: 'asset_valuation_history',
  rawImports: 'raw_imports',
  newsArticles: 'news_articles',
} as const;

import { tryGetDb, COLLECTIONS } from '@/lib/db/mongo';

/**
 * Asset valuation history lives in MongoDB, not Postgres, because the metadata
 * that matters differs completely per asset type:
 *   gold     -> { grams, purity, ratePerGram }
 *   property -> { sqft, city, circleRate }
 *   equity   -> { units, nav, folio }
 * Modelling that relationally would mean either a wide sparse table or an EAV
 * mess; a document per valuation is the honest fit.
 *
 * Every function no-ops when Mongo is unavailable — Postgres remains the system
 * of record for the current value, so nothing breaks without it.
 *
 * @typedef {object} ValuationEntry
 * @property {number} userId
 * @property {number} assetId
 * @property {string} valuationDate
 * @property {number} value
 * @property {Record<string, unknown>} [typeSpecificMetadata]
 * @property {Date} recordedAt
 */

/**
 * @param {Omit<ValuationEntry, 'recordedAt'>} entry
 * @returns {Promise<void>}
 */
export async function recordValuation(entry) {
  const db = await tryGetDb();
  if (!db) return;
  await db.collection(COLLECTIONS.assetValuationHistory).insertOne({
    ...entry,
    recordedAt: new Date(),
  });
}

/**
 * @param {number} userId
 * @param {number} assetId
 */
export async function getValuationHistory(userId, assetId) {
  const db = await tryGetDb();
  if (!db) return [];
  return db
    .collection(COLLECTIONS.assetValuationHistory)
    .find({ userId, assetId }, { projection: { _id: 0 } })
    .sort({ valuationDate: 1 })
    .toArray();
}

/**
 * @param {number} userId
 * @param {number} assetId
 * @returns {Promise<void>}
 */
export async function deleteValuationHistory(userId, assetId) {
  const db = await tryGetDb();
  if (!db) return;
  await db.collection(COLLECTIONS.assetValuationHistory).deleteMany({ userId, assetId });
}

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
 */
export interface ValuationEntry {
  userId: number;
  assetId: number;
  valuationDate: string;
  value: number;
  typeSpecificMetadata?: Record<string, unknown>;
  recordedAt: Date;
}

export async function recordValuation(entry: Omit<ValuationEntry, 'recordedAt'>): Promise<void> {
  const db = await tryGetDb();
  if (!db) return;
  await db.collection<ValuationEntry>(COLLECTIONS.assetValuationHistory).insertOne({
    ...entry,
    recordedAt: new Date(),
  });
}

export async function getValuationHistory(userId: number, assetId: number) {
  const db = await tryGetDb();
  if (!db) return [];
  return db
    .collection<ValuationEntry>(COLLECTIONS.assetValuationHistory)
    .find({ userId, assetId }, { projection: { _id: 0 } })
    .sort({ valuationDate: 1 })
    .toArray();
}

export async function deleteValuationHistory(userId: number, assetId: number): Promise<void> {
  const db = await tryGetDb();
  if (!db) return;
  await db.collection(COLLECTIONS.assetValuationHistory).deleteMany({ userId, assetId });
}

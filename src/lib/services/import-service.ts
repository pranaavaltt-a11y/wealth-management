import { ObjectId } from 'mongodb';
import { tryGetDb, COLLECTIONS, isMongoConfigured } from '@/lib/db/mongo';
import { normaliseStatement, type ParseResult } from './csv-parser';
import { categoriseRows, findExistingHashes, type CategorisedRow } from '@/lib/db/imports';

/**
 * Orchestrates a statement import.
 *
 *   upload -> parse -> stage raw rows in Mongo -> categorise -> preview
 *   user edits categories -> commit (one Postgres transaction)
 *
 * Raw rows are staged in MongoDB because that is what they are: ragged,
 * bank-specific, and worth keeping verbatim for audit without forcing them
 * into a relational shape. The normalised result goes to Postgres.
 *
 * Staging is best-effort. With Mongo unavailable the import still completes —
 * the user simply loses the raw audit copy, which is strictly better than
 * refusing to import their statement at all.
 */

export interface RawImportDoc {
  _id?: ObjectId;
  userId: number;
  sourceBank: string;
  fileName: string;
  fileType: string;
  rawRows: string[][];
  rowCount: number;
  parsedAt: Date;
  matchStatus: 'staged' | 'committed' | 'reverted';
  committedAt?: Date;
  insertedCount?: number;
}

export interface ImportPreview {
  batchId: string | null;
  mongoAvailable: boolean;
  fileName: string;
  sourceBank: string;
  headerRow: number;
  detectedColumns: string[];
  rows: (CategorisedRow & { duplicate: boolean })[];
  skipped: ParseResult['skipped'];
  summary: {
    parsed: number;
    newRows: number;
    duplicates: number;
    skipped: number;
    totalIncome: number;
    totalExpense: number;
    uncategorised: number;
  };
}

/** Best-effort guess at the issuing bank, from the filename and header text. */
function detectBank(fileName: string, sample: string): string {
  const haystack = `${fileName} ${sample}`.toUpperCase();
  const banks = ['HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK', 'YES BANK', 'IDFC',
                 'CANARA', 'PNB', 'BANK OF BARODA', 'INDUSIND'];
  return banks.find((b) => haystack.includes(b)) ?? 'Unknown';
}

export async function buildPreview(
  userId: number,
  fileName: string,
  csvText: string,
): Promise<ImportPreview> {
  const parsed = normaliseStatement(csvText);
  const sourceBank = detectBank(fileName, csvText.slice(0, 600));

  // 1. Stage the raw rows (best-effort).
  let batchId: string | null = null;
  const db = await tryGetDb();
  if (db) {
    const doc: RawImportDoc = {
      userId,
      sourceBank,
      fileName,
      fileType: 'csv',
      rawRows: parsed.rows.map((r) => [
        String(r.rowNumber), r.txnDate, r.description, r.amount.toFixed(2), r.txnType,
      ]),
      rowCount: parsed.rows.length,
      parsedAt: new Date(),
      matchStatus: 'staged',
    };
    const res = await db.collection<RawImportDoc>(COLLECTIONS.rawImports).insertOne(doc);
    batchId = res.insertedId.toHexString();
  }

  // 2. Categorise every row through the SQL rule engine.
  const categorised = await categoriseRows(userId, parsed.rows);

  // 3. Flag rows the user already has.
  const existing = await findExistingHashes(userId, categorised.map((r) => r.importHash));
  const rows = categorised.map((r) => ({ ...r, duplicate: existing.has(r.importHash) }));

  const fresh = rows.filter((r) => !r.duplicate);
  return {
    batchId,
    mongoAvailable: Boolean(db),
    fileName,
    sourceBank,
    headerRow: parsed.headerRow,
    detectedColumns: parsed.detectedColumns,
    rows,
    skipped: parsed.skipped,
    summary: {
      parsed: parsed.rows.length,
      newRows: fresh.length,
      duplicates: rows.length - fresh.length,
      skipped: parsed.skipped.length,
      totalIncome: fresh.filter((r) => r.txnType === 'income').reduce((s, r) => s + r.amount, 0),
      totalExpense: fresh.filter((r) => r.txnType === 'expense').reduce((s, r) => s + r.amount, 0),
      uncategorised: fresh.filter((r) => r.category === 'Uncategorized').length,
    },
  };
}

/** Marks the staged Mongo document as committed. Never blocks the import. */
export async function markBatchCommitted(batchId: string, insertedCount: number): Promise<void> {
  if (!isMongoConfigured() || !ObjectId.isValid(batchId)) return;
  const db = await tryGetDb();
  if (!db) return;
  await db.collection<RawImportDoc>(COLLECTIONS.rawImports).updateOne(
    { _id: new ObjectId(batchId) },
    { $set: { matchStatus: 'committed', committedAt: new Date(), insertedCount } },
  );
}

export async function listBatches(userId: number, limit = 20) {
  const db = await tryGetDb();
  if (!db) return [];
  return db
    .collection<RawImportDoc>(COLLECTIONS.rawImports)
    .find({ userId }, { projection: { rawRows: 0 } })
    .sort({ parsedAt: -1 })
    .limit(limit)
    .toArray();
}

/**
 * Per-bank import statistics — a MongoDB aggregation pipeline, the Mongo-side
 * counterpart to the SQL GROUP BY views.
 */
export async function importStatsByBank(userId: number) {
  const db = await tryGetDb();
  if (!db) return [];
  return db.collection<RawImportDoc>(COLLECTIONS.rawImports).aggregate([
    { $match: { userId } },
    { $group: {
        _id: '$sourceBank',
        imports: { $sum: 1 },
        totalRows: { $sum: '$rowCount' },
        committed: { $sum: { $cond: [{ $eq: ['$matchStatus', 'committed'] }, 1, 0] } },
        lastImport: { $max: '$parsedAt' },
    } },
    { $project: { _id: 0, sourceBank: '$_id', imports: 1, totalRows: 1, committed: 1, lastImport: 1 } },
    { $sort: { totalRows: -1 } },
  ]).toArray();
}

import { ObjectId } from 'mongodb';
import { tryGetDb, COLLECTIONS, isMongoConfigured } from '@/lib/db/mongo';
import { normaliseStatement } from './csv-parser';
import { categoriseRows, findExistingHashes } from '@/lib/db/imports';

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
 *
 * @typedef {object} RawImportDoc
 * @property {ObjectId} [_id]
 * @property {number} userId
 * @property {string} sourceBank
 * @property {string} fileName
 * @property {string} fileType
 * @property {string[][]} rawRows
 * @property {number} rowCount
 * @property {Date} parsedAt
 * @property {'staged' | 'committed' | 'reverted'} matchStatus
 * @property {Date} [committedAt]
 * @property {number} [insertedCount]
 */

/**
 * @typedef {object} ImportPreview
 * @property {string | null} batchId
 * @property {boolean} mongoAvailable
 * @property {string} fileName
 * @property {string} sourceBank
 * @property {number} headerRow
 * @property {string[]} detectedColumns
 * @property {(CategorisedRow & { duplicate: boolean })[]} rows
 * @property {ParseResult['skipped']} skipped
 * @property {{ parsed: number, newRows: number, duplicates: number, skipped: number, totalIncome: number, totalExpense: number, uncategorised: number }} summary
 */

/**
 * Best-effort guess at the issuing bank, from the filename and header text.
 *
 * @param {string} fileName
 * @param {string} sample
 * @returns {string}
 */
function detectBank(fileName, sample) {
  const haystack = `${fileName} ${sample}`.toUpperCase();
  const banks = [
    'HDFC',
    'ICICI',
    'SBI',
    'AXIS',
    'KOTAK',
    'YES BANK',
    'IDFC',
    'CANARA',
    'PNB',
    'BANK OF BARODA',
    'INDUSIND',
  ];
  return banks.find((b) => haystack.includes(b)) ?? 'Unknown';
}

/**
 * @param {number} userId
 * @param {string} fileName
 * @param {string} csvText
 * @returns {Promise<ImportPreview>}
 */
export async function buildPreview(userId, fileName, csvText) {
  const parsed = normaliseStatement(csvText);
  const sourceBank = detectBank(fileName, csvText.slice(0, 600));

  // 1. Stage the raw rows (best-effort).
  let batchId = null;
  const db = await tryGetDb();
  if (db) {
    const doc = {
      userId,
      sourceBank,
      fileName,
      fileType: 'csv',
      rawRows: parsed.rows.map((r) => [
        String(r.rowNumber),
        r.txnDate,
        r.description,
        r.amount.toFixed(2),
        r.txnType,
      ]),
      rowCount: parsed.rows.length,
      parsedAt: new Date(),
      matchStatus: 'staged',
    };
    const res = await db.collection(COLLECTIONS.rawImports).insertOne(doc);
    batchId = res.insertedId.toHexString();
  }

  // 2. Categorise every row through the SQL rule engine.
  const categorised = await categoriseRows(userId, parsed.rows);

  // 3. Flag rows the user already has.
  const existing = await findExistingHashes(
    userId,
    categorised.map((r) => r.importHash),
  );
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

/**
 * Marks the staged Mongo document as committed. Never blocks the import.
 *
 * @param {string} batchId
 * @param {number} insertedCount
 * @returns {Promise<void>}
 */
export async function markBatchCommitted(batchId, insertedCount) {
  if (!isMongoConfigured() || !ObjectId.isValid(batchId)) return;
  const db = await tryGetDb();
  if (!db) return;
  await db
    .collection(COLLECTIONS.rawImports)
    .updateOne(
      { _id: new ObjectId(batchId) },
      { $set: { matchStatus: 'committed', committedAt: new Date(), insertedCount } },
    );
}

/**
 * @param {number} userId
 * @param {number} [limit=20]
 */
export async function listBatches(userId, limit = 20) {
  const db = await tryGetDb();
  if (!db) return [];
  return db
    .collection(COLLECTIONS.rawImports)
    .find({ userId }, { projection: { rawRows: 0 } })
    .sort({ parsedAt: -1 })
    .limit(limit)
    .toArray();
}

/**
 * Per-bank import statistics — a MongoDB aggregation pipeline, the Mongo-side
 * counterpart to the SQL GROUP BY views.
 *
 * @param {number} userId
 */
export async function importStatsByBank(userId) {
  const db = await tryGetDb();
  if (!db) return [];
  return db
    .collection(COLLECTIONS.rawImports)
    .aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: '$sourceBank',
          imports: { $sum: 1 },
          totalRows: { $sum: '$rowCount' },
          committed: { $sum: { $cond: [{ $eq: ['$matchStatus', 'committed'] }, 1, 0] } },
          lastImport: { $max: '$parsedAt' },
        },
      },
      { $project: { _id: 0, sourceBank: '$_id', imports: 1, totalRows: 1, committed: 1, lastImport: 1 } },
      { $sort: { totalRows: -1 } },
    ])
    .toArray();
}

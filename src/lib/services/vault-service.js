import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { ObjectId } from 'mongodb';
import { tryGetDb, COLLECTIONS } from '@/lib/db/mongo';

/**
 * Document vault — loan papers, sale deeds, receipts.
 *
 * Metadata lives in MongoDB because it is genuinely irregular: a property deed
 * carries survey numbers and registration details, a loan sanction letter
 * carries a reference number and sanction date, a receipt carries a merchant
 * and GSTIN. Forcing all of that into one relational table means a wide sparse
 * table or an EAV mess.
 *
 * The FILE itself goes to disk under public/uploads, not into Mongo. GridFS
 * would be the answer for anything over 16MB, but for an academic deployment a
 * filesystem path is simpler and honest about what it is.
 */

const UPLOAD_DIR = join(process.cwd(), 'public', 'uploads');

/** Only formats a financial document plausibly arrives in. */
const ALLOWED_MIME = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * @typedef {object} VaultDoc
 * @property {ObjectId} [_id]
 * @property {number} userId
 * @property {'loan' | 'asset' | 'general'} refType
 * @property {number | null} refId
 * @property {string} title
 * @property {string} fileName - stored name on disk (random, not user-supplied)
 * @property {string} originalName - what the user called it
 * @property {string} fileUrl
 * @property {string} mimeType
 * @property {number} sizeBytes
 * @property {string} checksum
 * @property {string[]} tags
 * @property {Date} uploadedAt
 */

export class VaultError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {unknown} db
 * @returns {db is object}
 */
export function vaultAvailable(db) {
  return db !== null;
}

/**
 * @param {{ userId: number, refType: VaultDoc['refType'], refId: number | null, title: string, tags: string[], originalName: string, mimeType: string, bytes: Buffer }} input
 * @returns {Promise<VaultDoc>}
 */
export async function saveDocument(input) {
  const ext = ALLOWED_MIME[input.mimeType];
  if (!ext) {
    throw new VaultError(415, `Unsupported file type "${input.mimeType}". Allowed: PDF, JPEG, PNG, WebP.`);
  }
  if (input.bytes.length === 0) throw new VaultError(422, 'File is empty.');
  if (input.bytes.length > MAX_FILE_BYTES) {
    throw new VaultError(413, `File exceeds the ${MAX_FILE_BYTES / 1024 / 1024}MB limit.`);
  }

  const db = await tryGetDb();
  if (!db) {
    throw new VaultError(503, 'Document vault needs MongoDB. Set MONGODB_URI and restart.');
  }

  // The stored filename is generated, never derived from user input — a
  // user-supplied name is a path-traversal vector ("../../.env") and the
  // extension is taken from the validated MIME type, not from what they typed.
  const storedName = `${randomUUID()}${ext}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(join(UPLOAD_DIR, storedName), input.bytes);

  const doc = {
    userId: input.userId,
    refType: input.refType,
    refId: input.refId,
    title: input.title.trim() || input.originalName,
    fileName: storedName,
    originalName: input.originalName.slice(0, 200),
    fileUrl: `/uploads/${storedName}`,
    mimeType: input.mimeType,
    sizeBytes: input.bytes.length,
    checksum: createHash('sha256').update(input.bytes).digest('hex'),
    tags: input.tags
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 12),
    uploadedAt: new Date(),
  };

  const res = await db.collection(COLLECTIONS.documents).insertOne(doc);
  return { ...doc, _id: res.insertedId };
}

/**
 * @typedef {object} VaultFilter
 * @property {string} [refType]
 * @property {number} [refId]
 * @property {string} [tag]
 * @property {string} [search]
 */

/**
 * Filtered listing. Text search covers title, original filename and tags.
 *
 * @param {number} userId
 * @param {VaultFilter} [f={}]
 */
export async function listDocuments(userId, f = {}) {
  const db = await tryGetDb();
  if (!db) return null;

  const q = { userId };
  if (f.refType && f.refType !== 'all') q.refType = f.refType;
  if (f.refId) q.refId = f.refId;
  if (f.tag) q.tags = f.tag.toLowerCase();
  if (f.search) {
    // Escaped so a user typing "a.pdf" or "(2)" cannot inject regex syntax.
    const safe = f.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(safe, 'i');
    q.$or = [{ title: rx }, { originalName: rx }, { tags: rx }];
  }

  return db.collection(COLLECTIONS.documents).find(q).sort({ uploadedAt: -1 }).limit(200).toArray();
}

/**
 * @param {number} userId
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteDocument(userId, id) {
  if (!ObjectId.isValid(id)) return false;
  const db = await tryGetDb();
  if (!db) throw new VaultError(503, 'Document vault needs MongoDB.');

  // userId in the filter is the ownership check — one round trip, no TOCTOU gap.
  const doc = await db.collection(COLLECTIONS.documents).findOneAndDelete({ _id: new ObjectId(id), userId });
  if (!doc) return false;

  // Best-effort: a missing file should not fail the metadata delete.
  await unlink(join(UPLOAD_DIR, doc.fileName)).catch(() => {});
  return true;
}

/**
 * Vault rollup — a MongoDB aggregation pipeline. $unwind flattens the tags
 * array so each tag can be counted independently, which is exactly the kind of
 * query a relational tag table would need a join table to answer.
 *
 * @param {number} userId
 */
export async function vaultStats(userId) {
  const db = await tryGetDb();
  if (!db) return null;
  const col = db.collection(COLLECTIONS.documents);

  const [byType, byTag] = await Promise.all([
    col
      .aggregate([
        { $match: { userId } },
        { $group: { _id: '$refType', count: { $sum: 1 }, bytes: { $sum: '$sizeBytes' } } },
        { $project: { _id: 0, refType: '$_id', count: 1, bytes: 1 } },
        { $sort: { count: -1 } },
      ])
      .toArray(),
    col
      .aggregate([
        { $match: { userId } },
        { $unwind: '$tags' },
        { $group: { _id: '$tags', count: { $sum: 1 } } },
        { $project: { _id: 0, tag: '$_id', count: 1 } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ])
      .toArray(),
  ]);

  return { byType, byTag };
}

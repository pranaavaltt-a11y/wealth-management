import { query, num } from './postgres';
/**
 * @typedef {object} Transaction
 * @property {number} id
 * @property {string} txnType
 * @property {number} amount
 * @property {string} txnDate
 * @property {string} category
 * @property {string | null} description
 * @property {string} source
 * @property {number | null} relatedAssetId
 * @property {number | null} relatedLoanId
 */

/**
 * @param {Record<string, string | null>} r
 * @returns {Transaction}
 */
function toTxn(r) {
  return {
    id: Number(r.id),
    txnType: r.txn_type,
    amount: num(r.amount),
    txnDate: r.txn_date,
    category: r.category,
    description: r.description,
    source: r.source,
    relatedAssetId: r.related_asset_id ? Number(r.related_asset_id) : null,
    relatedLoanId: r.related_loan_id ? Number(r.related_loan_id) : null,
  };
}

const TXN_COLS = `id, txn_type, amount, txn_date, category, description, source,
                  related_asset_id, related_loan_id`;

/**
 * @typedef {object} TxnFilter
 * @property {string} [type]
 * @property {string} [from]
 * @property {string} [to]
 * @property {string} [category]
 * @property {string} [search]
 * @property {number} [limit]
 */

/**
 * Filtered ledger. Optional filters are applied as `($n IS NULL OR col = $n)`
 * so one prepared statement serves every combination — no string concatenation
 * and therefore no injection surface.
 *
 * `search` runs against the generated `search_vector` tsvector (GIN-indexed,
 * migration 006) rather than a LIKE '%...%' scan, so it matches word stems:
 * "pharmacy" finds "Pharmacies". websearch_to_tsquery is used instead of
 * to_tsquery because it accepts whatever a human types without throwing a
 * syntax error on a stray quote or operator.
 *
 * @param {number} userId
 * @param {TxnFilter} [f={}]
 * @returns {Promise<Transaction[]>}
 */
export async function listTransactions(userId, f = {}) {
  const rows = await query(
    `SELECT ${TXN_COLS}
       FROM transactions
      WHERE user_id = $1
        AND ($2::text IS NULL OR txn_type = $2::txn_type)
        AND ($3::date IS NULL OR txn_date >= $3::date)
        AND ($4::date IS NULL OR txn_date <= $4::date)
        AND ($5::text IS NULL OR category ILIKE $5)
        AND ($6::text IS NULL OR search_vector @@ websearch_to_tsquery('english', $6))
      ORDER BY
        -- Best matches first when searching; newest first otherwise.
        CASE WHEN $6::text IS NULL THEN 0
             ELSE ts_rank(search_vector, websearch_to_tsquery('english', $6)) END DESC,
        txn_date DESC, id DESC
      LIMIT $7`,
    [
      userId,
      f.type ?? null,
      f.from ?? null,
      f.to ?? null,
      f.category ?? null,
      f.search || null,
      f.limit ?? 200,
    ],
  );
  return rows.map(toTxn);
}

/**
 * @param {number} userId
 * @param {TransactionInput} input
 * @returns {Promise<Transaction>}
 */
export async function createTransaction(userId, input) {
  const rows = await query(
    `INSERT INTO transactions (user_id, txn_type, amount, txn_date, category, description,
                               source, related_asset_id, related_loan_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7, $8)
     RETURNING ${TXN_COLS}`,
    [
      userId,
      input.txnType,
      input.amount,
      input.txnDate,
      input.category,
      input.description || null,
      input.relatedAssetId ?? null,
      input.relatedLoanId ?? null,
    ],
  );
  return toTxn(rows[0]);
}

/**
 * @param {number} userId
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function deleteTransaction(userId, id) {
  const rows = await query(`DELETE FROM transactions WHERE id = $1 AND user_id = $2 RETURNING id`, [
    id,
    userId,
  ]);
  return rows.length > 0;
}

/**
 * Month-to-date income/expense totals plus the top spending categories.
 * Two aggregates over the same filtered set, kept as separate queries because
 * one GROUP BY cannot produce both shapes cleanly.
 *
 * @param {number} userId
 * @param {string} monthStart
 */
export async function monthlySummary(userId, monthStart) {
  const totals = await query(
    `SELECT txn_type, SUM(amount) AS total, COUNT(*) AS txn_count
       FROM transactions
      WHERE user_id = $1
        AND txn_date >= $2::date
        AND txn_date < ($2::date + INTERVAL '1 month')
      GROUP BY txn_type`,
    [userId, monthStart],
  );

  const byCategory = await query(
    `SELECT category,
            SUM(amount) AS total,
            ROUND(100.0 * SUM(amount) / NULLIF(SUM(SUM(amount)) OVER (), 0), 2) AS pct
       FROM transactions
      WHERE user_id = $1
        AND txn_type = 'expense'
        AND txn_date >= $2::date
        AND txn_date < ($2::date + INTERVAL '1 month')
      GROUP BY category
      ORDER BY total DESC
      LIMIT 8`,
    [userId, monthStart],
  );

  return {
    totals: totals.map((r) => ({ txnType: r.txn_type, total: num(r.total), count: Number(r.txn_count) })),
    byCategory: byCategory.map((r) => ({ category: r.category, total: num(r.total), pct: num(r.pct) })),
  };
}

/**
 * Records a confirmed receipt as an expense.
 *
 * Reuses the import dedupe machinery: the receipt gets an import_hash over
 * (date, amount, merchant), so the partial unique index on
 * (user_id, import_hash) refuses the same receipt being confirmed twice.
 * Returns null on that conflict.
 *
 * @param {number} userId
 * @param {{ amount: number, txnDate: string, merchant: string, category: string, importHash: string }} input
 * @returns {Promise<Transaction | null>}
 */
export async function createReceiptTransaction(userId, input) {
  const rows = await query(
    `INSERT INTO transactions (user_id, txn_type, amount, txn_date, category, description,
                               source, import_hash)
     VALUES ($1, 'expense', $2, $3, $4, $5, 'receipt', $6)
     ON CONFLICT (user_id, import_hash) WHERE import_hash IS NOT NULL DO NOTHING
     RETURNING ${TXN_COLS}`,
    [userId, input.amount, input.txnDate, input.category, input.merchant, input.importHash],
  );
  return rows[0] ? toTxn(rows[0]) : null;
}

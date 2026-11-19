import { query, withTransaction, num } from './postgres';
/**
 * Bank statement import: the database half.
 *
 * The whole commit is ONE transaction. A statement is a unit — landing 40 of
 * 60 rows because the 41st violated a constraint would leave the user with a
 * ledger they cannot trust and no clean way to retry.
 *
 * @typedef {ParsedRow & { category: string, matchedKeyword: string | null }} CategorisedRow
 * @property {string} category
 * @property {string | null} matchedKeyword
 */

/**
 * Runs each description through fn_categorize() in a single round trip.
 *
 * UNNEST turns the two parallel arrays into rows, and the LATERAL join calls
 * the function once per row — rather than issuing N separate queries from
 * application code, which is the obvious-but-slow way to do this.
 *
 * @param {number} userId
 * @param {ParsedRow[]} rows
 * @returns {Promise<CategorisedRow[]>}
 */
export async function categoriseRows(userId, rows) {
  if (rows.length === 0) return [];

  const results = await query(
    `SELECT t.idx,
            c.category,
            c.matched_keyword
       FROM UNNEST($2::int[], $3::text[]) WITH ORDINALITY AS t(idx, description, ord)
       LEFT JOIN LATERAL fn_categorize($1, t.description) c ON TRUE`,
    [userId, rows.map((_, i) => i), rows.map((r) => r.description)],
  );

  const byIdx = new Map(results.map((r) => [Number(r.idx), r]));
  return rows.map((r, i) => {
    const hit = byIdx.get(i);
    return {
      ...r,
      category: hit?.category ?? 'Uncategorized',
      matchedKeyword: hit?.matched_keyword ?? null,
    };
  });
}

/**
 * Which of these hashes does the user already have? Drives the preview.
 *
 * @param {number} userId
 * @param {string[]} hashes
 * @returns {Promise<Set<string>>}
 */
export async function findExistingHashes(userId, hashes) {
  if (hashes.length === 0) return new Set();
  const rows = await query(
    `SELECT import_hash
       FROM transactions
      WHERE user_id = $1
        AND import_hash = ANY($2::text[])`,
    [userId, hashes],
  );
  return new Set(rows.map((r) => r.import_hash));
}

/**
 * @typedef {object} CommitResult
 * @property {number} inserted
 * @property {number} duplicatesSkipped
 * @property {number} totalIncome
 * @property {number} totalExpense
 */

/**
 * Atomic bulk insert.
 *
 * One multi-row INSERT built from UNNEST rather than N single-row INSERTs:
 * the whole statement becomes one statement to plan and one round trip.
 *
 * ON CONFLICT DO NOTHING against the partial unique index
 * idx_txn_import_hash (user_id, import_hash) WHERE import_hash IS NOT NULL
 * makes deduplication a database guarantee. The preview already filters known
 * duplicates, but two tabs committing the same file at once would race past
 * that check — the index is what actually holds the line.
 *
 * @param {number} userId
 * @param {CategorisedRow[]} rows
 * @param {string | null} batchId
 * @returns {Promise<CommitResult>}
 */
export async function commitImport(userId, rows, batchId) {
  if (rows.length === 0) {
    return { inserted: 0, duplicatesSkipped: 0, totalIncome: 0, totalExpense: 0 };
  }

  return withTransaction(async (client) => {
    const { rows: inserted } = await client.query(
      `INSERT INTO transactions
         (user_id, txn_type, amount, txn_date, category, description,
          source, import_hash, import_batch_id)
       SELECT $1,
              t.txn_type::txn_type,
              t.amount,
              t.txn_date::date,
              t.category,
              t.description,
              'import',
              t.import_hash,
              $8
         FROM UNNEST(
                $2::text[], $3::numeric[], $4::text[],
                $5::text[], $6::text[], $7::text[]
              ) AS t(txn_type, amount, txn_date, category, description, import_hash)
       ON CONFLICT (user_id, import_hash) WHERE import_hash IS NOT NULL DO NOTHING
       RETURNING txn_type, amount`,
      [
        userId,
        rows.map((r) => r.txnType),
        rows.map((r) => r.amount),
        rows.map((r) => r.txnDate),
        rows.map((r) => r.category),
        rows.map((r) => r.description),
        rows.map((r) => r.importHash),
        batchId,
      ],
    );

    // The net worth trigger does not watch transactions (income and expense do
    // not change asset or loan balances), so nothing else needs refreshing here.
    let totalIncome = 0;
    let totalExpense = 0;
    for (const r of inserted) {
      if (r.txn_type === 'income') totalIncome += num(r.amount);
      else totalExpense += num(r.amount);
    }

    return {
      inserted: inserted.length,
      duplicatesSkipped: rows.length - inserted.length,
      totalIncome,
      totalExpense,
    };
  });
}

/**
 * Undo: remove everything that came from one upload.
 *
 * @param {number} userId
 * @param {string} batchId
 * @returns {Promise<number>}
 */
export async function revertBatch(userId, batchId) {
  const rows = await query(
    `DELETE FROM transactions
      WHERE user_id = $1 AND import_batch_id = $2
      RETURNING id`,
    [userId, batchId],
  );
  return rows.length;
}

/**
 * Re-applies the rule set to rows still sitting at 'Uncategorized'.
 *
 * @param {number} userId
 * @returns {Promise<number>}
 */
export async function recategorise(userId) {
  const rows = await query('SELECT fn_recategorize_user($1)', [userId]);
  return Number(rows[0]?.fn_recategorize_user ?? 0);
}

// ------------------------------------------------------ categorisation rules

/**
 * @typedef {object} Rule
 * @property {number} id
 * @property {string} keyword
 * @property {string} category
 * @property {string} txnType
 * @property {number} priority
 * @property {boolean} isSystem
 */

/**
 * @param {number} userId
 * @returns {Promise<Rule[]>}
 */
export async function listRules(userId) {
  const rows = await query(
    `SELECT id, keyword, category, txn_type, priority, (user_id IS NULL) AS is_system
       FROM categorization_rules
      WHERE is_active AND (user_id = $1 OR user_id IS NULL)
      ORDER BY (user_id IS NULL), priority, keyword`,
    [userId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    keyword: r.keyword,
    category: r.category,
    txnType: r.txn_type,
    priority: Number(r.priority),
    isSystem: r.is_system === true,
  }));
}

/**
 * @param {number} userId
 * @param {{ keyword: string, category: string, txnType: string, priority?: number }} input
 * @returns {Promise<Rule>}
 */
export async function createRule(userId, input) {
  const rows = await query(
    `INSERT INTO categorization_rules (user_id, keyword, category, txn_type, priority)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, upper(keyword)) WHERE user_id IS NOT NULL
       DO UPDATE SET category = EXCLUDED.category,
                     txn_type = EXCLUDED.txn_type,
                     priority = EXCLUDED.priority,
                     is_active = TRUE
     RETURNING id, keyword, category, txn_type, priority, (user_id IS NULL) AS is_system`,
    [userId, input.keyword.trim(), input.category.trim(), input.txnType, input.priority ?? 50],
  );
  const r = rows[0];
  return {
    id: Number(r.id),
    keyword: r.keyword,
    category: r.category,
    txnType: r.txn_type,
    priority: Number(r.priority),
    isSystem: false,
  };
}

/**
 * A user may only delete their own rules; system rules are shared.
 *
 * @param {number} userId
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function deleteRule(userId, id) {
  const rows = await query(
    `DELETE FROM categorization_rules
      WHERE id = $1 AND user_id = $2
      RETURNING id`,
    [id, userId],
  );
  return rows.length > 0;
}

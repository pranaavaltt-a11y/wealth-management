import { query, withTransaction, num } from './postgres';
import type { ParsedRow } from '@/lib/services/csv-parser';

/**
 * Bank statement import: the database half.
 *
 * The whole commit is ONE transaction. A statement is a unit — landing 40 of
 * 60 rows because the 41st violated a constraint would leave the user with a
 * ledger they cannot trust and no clean way to retry.
 */

export interface CategorisedRow extends ParsedRow {
  category: string;
  matchedKeyword: string | null;
}

/**
 * Runs each description through fn_categorize() in a single round trip.
 *
 * UNNEST turns the two parallel arrays into rows, and the LATERAL join calls
 * the function once per row — rather than issuing N separate queries from
 * TypeScript, which is the obvious-but-slow way to do this.
 */
export async function categoriseRows(userId: number, rows: ParsedRow[]): Promise<CategorisedRow[]> {
  if (rows.length === 0) return [];

  const results = await query<{ idx: number; category: string | null; matched_keyword: string | null }>(
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

/** Which of these hashes does the user already have? Drives the preview. */
export async function findExistingHashes(userId: number, hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const rows = await query<{ import_hash: string }>(
    `SELECT import_hash
       FROM transactions
      WHERE user_id = $1
        AND import_hash = ANY($2::text[])`,
    [userId, hashes],
  );
  return new Set(rows.map((r) => r.import_hash));
}

export interface CommitResult {
  inserted: number;
  duplicatesSkipped: number;
  totalIncome: number;
  totalExpense: number;
}

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
 */
export async function commitImport(
  userId: number,
  rows: CategorisedRow[],
  batchId: string | null,
): Promise<CommitResult> {
  if (rows.length === 0) {
    return { inserted: 0, duplicatesSkipped: 0, totalIncome: 0, totalExpense: 0 };
  }

  return withTransaction(async (client) => {
    const { rows: inserted } = await client.query<{ txn_type: string; amount: string }>(
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

/** Undo: remove everything that came from one upload. */
export async function revertBatch(userId: number, batchId: string): Promise<number> {
  const rows = await query(
    `DELETE FROM transactions
      WHERE user_id = $1 AND import_batch_id = $2
      RETURNING id`,
    [userId, batchId],
  );
  return rows.length;
}

/** Re-applies the rule set to rows still sitting at 'Uncategorized'. */
export async function recategorise(userId: number): Promise<number> {
  const rows = await query<{ fn_recategorize_user: number }>(
    'SELECT fn_recategorize_user($1)', [userId],
  );
  return Number(rows[0]?.fn_recategorize_user ?? 0);
}

// ------------------------------------------------------ categorisation rules

export interface Rule {
  id: number;
  keyword: string;
  category: string;
  txnType: string;
  priority: number;
  isSystem: boolean;
}

export async function listRules(userId: number): Promise<Rule[]> {
  const rows = await query<Record<string, string | number | boolean | null>>(
    `SELECT id, keyword, category, txn_type, priority, (user_id IS NULL) AS is_system
       FROM categorization_rules
      WHERE is_active AND (user_id = $1 OR user_id IS NULL)
      ORDER BY (user_id IS NULL), priority, keyword`,
    [userId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    keyword: r.keyword as string,
    category: r.category as string,
    txnType: r.txn_type as string,
    priority: Number(r.priority),
    isSystem: r.is_system === true,
  }));
}

export async function createRule(userId: number, input: {
  keyword: string; category: string; txnType: string; priority?: number;
}): Promise<Rule> {
  const rows = await query<Record<string, string | number | boolean | null>>(
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
    keyword: r.keyword as string,
    category: r.category as string,
    txnType: r.txn_type as string,
    priority: Number(r.priority),
    isSystem: false,
  };
}

/** A user may only delete their own rules; system rules are shared. */
export async function deleteRule(userId: number, id: number): Promise<boolean> {
  const rows = await query(
    `DELETE FROM categorization_rules
      WHERE id = $1 AND user_id = $2
      RETURNING id`,
    [id, userId],
  );
  return rows.length > 0;
}

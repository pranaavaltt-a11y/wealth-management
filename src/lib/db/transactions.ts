import { query, num } from './postgres';
import type { TransactionInput } from '@/lib/validation/schemas';

export interface Transaction {
  id: number;
  txnType: string;
  amount: number;
  txnDate: string;
  category: string;
  description: string | null;
  source: string;
  relatedAssetId: number | null;
  relatedLoanId: number | null;
}

function toTxn(r: Record<string, string | null>): Transaction {
  return {
    id: Number(r.id),
    txnType: r.txn_type as string,
    amount: num(r.amount),
    txnDate: r.txn_date as string,
    category: r.category as string,
    description: r.description,
    source: r.source as string,
    relatedAssetId: r.related_asset_id ? Number(r.related_asset_id) : null,
    relatedLoanId: r.related_loan_id ? Number(r.related_loan_id) : null,
  };
}

const TXN_COLS = `id, txn_type, amount, txn_date, category, description, source,
                  related_asset_id, related_loan_id`;

export interface TxnFilter {
  type?: string;
  from?: string;
  to?: string;
  category?: string;
  search?: string;
  limit?: number;
}

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
 */
export async function listTransactions(userId: number, f: TxnFilter = {}): Promise<Transaction[]> {
  const rows = await query<Record<string, string | null>>(
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
    [userId, f.type ?? null, f.from ?? null, f.to ?? null, f.category ?? null,
     f.search || null, f.limit ?? 200],
  );
  return rows.map(toTxn);
}

export async function createTransaction(userId: number, input: TransactionInput): Promise<Transaction> {
  const rows = await query<Record<string, string | null>>(
    `INSERT INTO transactions (user_id, txn_type, amount, txn_date, category, description,
                               source, related_asset_id, related_loan_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7, $8)
     RETURNING ${TXN_COLS}`,
    [
      userId, input.txnType, input.amount, input.txnDate, input.category,
      input.description || null, input.relatedAssetId ?? null, input.relatedLoanId ?? null,
    ],
  );
  return toTxn(rows[0]);
}

export async function deleteTransaction(userId: number, id: number): Promise<boolean> {
  const rows = await query(`DELETE FROM transactions WHERE id = $1 AND user_id = $2 RETURNING id`, [id, userId]);
  return rows.length > 0;
}

/**
 * Month-to-date income/expense totals plus the top spending categories.
 * Two aggregates over the same filtered set, kept as separate queries because
 * one GROUP BY cannot produce both shapes cleanly.
 */
export async function monthlySummary(userId: number, monthStart: string) {
  const totals = await query<{ txn_type: string; total: string; txn_count: string }>(
    `SELECT txn_type, SUM(amount) AS total, COUNT(*) AS txn_count
       FROM transactions
      WHERE user_id = $1
        AND txn_date >= $2::date
        AND txn_date < ($2::date + INTERVAL '1 month')
      GROUP BY txn_type`,
    [userId, monthStart],
  );

  const byCategory = await query<{ category: string; total: string; pct: string }>(
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

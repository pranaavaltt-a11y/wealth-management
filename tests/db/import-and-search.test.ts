import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, makeUser, one } from '../helpers';
import { normaliseStatement } from '../../src/lib/services/csv-parser';
import { categoriseRows, commitImport, revertBatch } from '../../src/lib/db/imports';
import { listTransactions } from '../../src/lib/db/transactions';

after(() => pool.end());

const CSV = [
  'Date,Narration,Withdrawal Amt.,Deposit Amt.',
  '01/08/26,"NEFT CR-INFOSYS-SALARY, AUG",,"1,65,000.00"',
  '03/08/26,UPI-SWIGGY BANGALORE,842.00,',
  '21/08/26,APOLLO PHARMACY JAYANAGAR,"1,185.50",',
  '24/08/26,SOME UNKNOWN MERCHANT,999.00,',
].join('\n');

describe('statement import', () => {
  it('categorises rows through fn_categorize, leaving unknowns Uncategorized', async () => {
    const u = await makeUser();
    const rows = await categoriseRows(u, normaliseStatement(CSV).rows);
    assert.deepEqual(rows.map((r) => r.category), ['Salary', 'Dining', 'Healthcare', 'Uncategorized']);
  });

  it('commits atomically, and re-importing the same file inserts nothing', async () => {
    const u = await makeUser();
    const rows = await categoriseRows(u, normaliseStatement(CSV).rows);
    const first = await commitImport(u, rows, 'batch-a');
    const second = await commitImport(u, rows, 'batch-b');
    assert.equal(first.inserted, 4);
    assert.equal(second.inserted, 0);
    assert.equal(second.duplicatesSkipped, 4);
  });

  it('rolls back the whole batch if any row violates a constraint', async () => {
    const u = await makeUser();
    const rows = await categoriseRows(u, normaliseStatement(CSV).rows);
    rows[2] = { ...rows[2], amount: -1 };   // CHECK (amount > 0) will fail mid-batch
    await assert.rejects(() => commitImport(u, rows, 'batch-bad'));
    const n = await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM transactions WHERE user_id = $1', [u]);
    assert.equal(n.n, 0, 'no partial import may survive');
  });

  it('reverting a batch removes exactly its rows', async () => {
    const u = await makeUser();
    const rows = await categoriseRows(u, normaliseStatement(CSV).rows);
    await commitImport(u, rows, 'batch-r');
    assert.equal(await revertBatch(u, 'batch-r'), 4);
  });
});

describe('categorisation rules', () => {
  it("a user's own rule beats the system rule, for that user only", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await pool.query(
      `INSERT INTO categorization_rules (user_id, keyword, category, priority) VALUES ($1, 'AMAZON', 'Business', 100)`, [a]);
    const ra = await one<{ category: string }>(`SELECT category FROM fn_categorize($1, 'AMAZON PAY INDIA')`, [a]);
    const rb = await one<{ category: string }>(`SELECT category FROM fn_categorize($1, 'AMAZON PAY INDIA')`, [b]);
    assert.equal(ra.category, 'Business');
    assert.equal(rb.category, 'Shopping');
  });
  it('a duplicate system rule is refused by the partial unique index', async () => {
    await assert.rejects(() => pool.query(
      `INSERT INTO categorization_rules (user_id, keyword, category) VALUES (NULL, 'swiggy', 'Other')`));
  });
  it('fn_recategorize_user applies a new rule retroactively', async () => {
    const u = await makeUser();
    await commitImport(u, await categoriseRows(u, normaliseStatement(CSV).rows), 'batch-rc');
    await pool.query(
      `INSERT INTO categorization_rules (user_id, keyword, category, priority) VALUES ($1, 'UNKNOWN MERCHANT', 'Gifts', 10)`, [u]);
    const r = await one<{ n: number }>('SELECT fn_recategorize_user($1) AS n', [u]);
    assert.equal(r.n, 1);
  });
});

describe('full-text search', () => {
  it('matches word stems through the GIN-indexed tsvector', async () => {
    const u = await makeUser();
    await pool.query(
      `INSERT INTO transactions (user_id, txn_type, amount, txn_date, category, description)
       VALUES ($1, 'expense', 120, CURRENT_DATE, 'Healthcare', 'Medicines from the local pharmacies')`, [u]);
    const hits = await listTransactions(u, { search: 'pharmacy' });
    assert.equal(hits.length, 1);
  });
  it('the planner can use idx_txn_search', async () => {
    // SET is per-connection, so hold one client for the whole check. The table
    // is tiny in tests, so seq scans are disabled to see whether the index is
    // usable at all — on real data volume the planner picks it on its own.
    const c = await pool.connect();
    try {
      await c.query('SET enable_seqscan = off');
      const plan = (await c.query(
        `EXPLAIN SELECT id FROM transactions WHERE search_vector @@ websearch_to_tsquery('english', 'pharmacy')`)).rows
        .map((r) => Object.values(r)[0]).join('\n');
      assert.match(plan, /idx_txn_search/);
    } finally {
      await c.query('RESET enable_seqscan');
      c.release();
    }
  });
});

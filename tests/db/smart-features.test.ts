import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, makeUser, makeLoan, makeAsset, payFirst, one, rejectsWith } from '../helpers';

after(() => pool.end());

const score = async (u: number) =>
  Number((await one<{ s: number }>('SELECT fn_compute_credit_score($1) AS s', [u])).s);

describe('credit score', () => {
  it('stays within 300–900 and records its factors', async () => {
    const u = await makeUser();
    await makeAsset(u, 2_000_000);
    const loan = await makeLoan(u, { start: '2020-01-01' });
    await payFirst(loan, 60);
    const s = await score(u);
    assert.ok(s >= 300 && s <= 900, `score ${s}`);
    const f = await one<{ f: Record<string, unknown> }>(
      'SELECT factors_json AS f FROM credit_score_history WHERE user_id = $1 ORDER BY computed_date DESC LIMIT 1', [u]);
    assert.ok(f.f.disclaimer, 'every score carries its not-a-bureau-score disclaimer');
  });

  it('an overdue installment lowers the score', async () => {
    const u = await makeUser();
    await makeAsset(u, 2_000_000);
    const loan = await makeLoan(u, { start: '2020-01-01' });
    await payFirst(loan, 60);
    const clean = await score(u);
    await pool.query(
      `UPDATE emi_schedule SET status = 'pending', paid_date = NULL WHERE loan_id = $1 AND installment_no = 60`, [loan]);
    assert.ok(await score(u) < clean);
  });

  it('the statement-level trigger rescores once when many EMIs are paid in one UPDATE', async () => {
    const u = await makeUser();
    const loan = await makeLoan(u, { start: '2021-01-01' });
    await pool.query('DELETE FROM credit_score_history WHERE user_id = $1', [u]);
    await payFirst(loan, 24);   // one statement touching 24 rows
    const r = await one<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM credit_score_history WHERE user_id = $1 AND computed_date = CURRENT_DATE', [u]);
    assert.equal(r.n, 1);
  });
});

describe('prepayment', () => {
  it('reduce_tenure saves more interest than reduce_emi, and both schedules end at 0.00', async () => {
    const u = await makeUser();
    const loan = await makeLoan(u, { principal: 5_000_000, rate: 8.5, tenure: 240, start: '2020-01-01' });
    await payFirst(loan, 60);
    const r = await one<Record<string, string>>(
      `SELECT (SELECT SUM(interest_component) FROM fn_simulate_prepayment($1, 500000, 'reduce_tenure')) AS ten,
              (SELECT SUM(interest_component) FROM fn_simulate_prepayment($1, 500000, 'reduce_emi'))    AS emi,
              (SELECT closing_balance FROM fn_simulate_prepayment($1, 500000, 'reduce_tenure')
                ORDER BY installment_no DESC LIMIT 1) AS ten_end,
              (SELECT closing_balance FROM fn_simulate_prepayment($1, 500000, 'reduce_emi')
                ORDER BY installment_no DESC LIMIT 1) AS emi_end`, [loan]);
    assert.ok(Number(r.ten) < Number(r.emi));
    assert.equal(r.ten_end, '0.00');
    assert.equal(r.emi_end, '0.00');
  });

  it('rejects a prepayment larger than the outstanding balance (WW422)', async () => {
    const loan = await makeLoan(await makeUser(), { principal: 100000 });
    await rejectsWith('WW422', () => pool.query(`SELECT * FROM fn_simulate_prepayment($1, 500000, 'reduce_tenure')`, [loan]));
  });

  it('sp_apply_prepayment funded from an asset leaves net worth unchanged', async () => {
    const u = await makeUser();
    const fd = await makeAsset(u, 600000, 'fd');
    const loan = await makeLoan(u, { principal: 1_000_000, start: '2023-01-01' });
    await payFirst(loan, 12);
    const nw = async () => (await one<{ n: string }>(
      'SELECT net_worth AS n FROM net_worth_snapshots WHERE user_id = $1 AND snapshot_date = CURRENT_DATE', [u])).n;
    const before = await nw();
    await pool.query(`CALL sp_apply_prepayment($1, $2, 300000, 'reduce_tenure', $3, NULL)`, [u, loan, fd]);
    assert.equal(await nw(), before);
    const a = await one<{ v: string }>('SELECT current_value AS v FROM assets WHERE id = $1', [fd]);
    assert.equal(a.v, '300000.00');
  });

  it('an under-funded prepayment rolls back completely', async () => {
    const u = await makeUser();
    const cash = await makeAsset(u, 1000);
    const loan = await makeLoan(u);
    const rowsBefore = (await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM emi_schedule WHERE loan_id = $1', [loan])).n;
    await rejectsWith('WW422', () =>
      pool.query(`CALL sp_apply_prepayment($1, $2, 50000, 'reduce_tenure', $3, NULL)`, [u, loan, cash]));
    const rowsAfter = (await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM emi_schedule WHERE loan_id = $1', [loan])).n;
    const prepay = (await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM loan_prepayments WHERE loan_id = $1', [loan])).n;
    assert.equal(rowsAfter, rowsBefore);
    assert.equal(prepay, 0);
  });

  it("refuses to prepay another user's loan (WW404)", async () => {
    const loan = await makeLoan(await makeUser());
    const intruder = await makeUser();
    await rejectsWith('WW404', () =>
      pool.query(`CALL sp_apply_prepayment($1, $2, 1000, 'reduce_tenure', NULL, NULL)`, [intruder, loan]));
  });
});

describe('recommendation engine', () => {
  it('marks a product ineligible with a reason when the score is below its minimum', async () => {
    const u = await makeUser();
    await pool.query(
      `INSERT INTO credit_score_history (user_id, score, computed_date) VALUES ($1, 600, CURRENT_DATE)
       ON CONFLICT (user_id, computed_date) DO UPDATE SET score = 600`, [u]);
    await pool.query(
      `INSERT INTO transactions (user_id, txn_type, amount, txn_date, category) VALUES ($1, 'income', 200000, CURRENT_DATE, 'Salary')`, [u]);
    // The product catalogue is seed data, not schema, so the test brings its own.
    await pool.query(
      `INSERT INTO loan_products (lender, product_name, loan_type, interest_rate_min, interest_rate_max,
                                  min_credit_score, max_tenure_months, min_amount, max_amount, processing_fee_pct)
       VALUES ('Strict Bank', 'Prime Gold', 'gold', 9, 11, 700, 36, 10000, 2000000, 0.5),
              ('Easy Bank',   'Open Gold',  'gold', 11, 14, 550, 36, 10000, 2000000, 1.0)
       ON CONFLICT (lender, product_name) DO NOTHING`);
    const rows = (await pool.query(
      `SELECT lender, eligible, reasons FROM fn_recommend_loan_products($1, 'gold', 100000, 12)`, [u])).rows;
    const strict = rows.find((r) => r.lender === 'Strict Bank');
    const easy = rows.find((r) => r.lender === 'Easy Bank');
    assert.equal(strict.eligible, false);
    assert.match(strict.reasons.join(' '), /below this lender's minimum of 700/);
    assert.equal(easy.eligible, true);
    assert.equal(rows[0].lender, 'Easy Bank', 'eligible products rank first');
  });
});

describe('what-if projection', () => {
  it('at 0% growth, closing a loan gains exactly its remaining interest', async () => {
    const u = await makeUser();
    await makeAsset(u, 5_000_000);
    const loan = await makeLoan(u, { principal: 800000, rate: 10, tenure: 60, start: '2025-01-01' });
    await payFirst(loan, 6);
    const r = await one<{ gain: string; interest: string }>(
      `SELECT (SELECT scenario_net_worth - net_worth FROM fn_project_net_worth($1, 120, $2, 0) WHERE month_offset = 120) AS gain,
              (SELECT SUM(interest_component) FROM emi_schedule WHERE loan_id = $2 AND status <> 'paid') AS interest`,
      [u, loan]);
    assert.equal(r.gain, r.interest);
  });
});

describe('financial year reporting', () => {
  it('31 March belongs to the previous FY, 1 April starts the next', async () => {
    const r = await one<{ a: string; b: string }>(
      `SELECT fn_fy_label(fn_fy_start_year('2026-03-31')) AS a, fn_fy_label(fn_fy_start_year('2026-04-01')) AS b`);
    assert.equal(r.a, 'FY 2025-26');
    assert.equal(r.b, 'FY 2026-27');
  });
  it('v_fy_summary splits transactions across the boundary', async () => {
    const u = await makeUser();
    await pool.query(
      `INSERT INTO transactions (user_id, txn_type, amount, txn_date, category)
       VALUES ($1, 'income', 100, '2026-03-31', 'Salary'), ($1, 'income', 200, '2026-04-01', 'Salary')`, [u]);
    const rows = (await pool.query(
      'SELECT fy_label, income FROM v_fy_summary WHERE user_id = $1 ORDER BY fy_start_year', [u])).rows;
    assert.deepEqual(rows.map((r) => [r.fy_label, r.income]), [['FY 2025-26', '100.00'], ['FY 2026-27', '200.00']]);
  });
});

describe('views', () => {
  it('v_recurring_expenses keeps only categories seen in 3+ distinct months (HAVING)', async () => {
    const u = await makeUser();
    await pool.query(
      `INSERT INTO transactions (user_id, txn_type, amount, txn_date, category)
       SELECT $1::bigint, 'expense'::txn_type, 500, (date_trunc('month', CURRENT_DATE) - (m || ' months')::interval)::date, 'Rent Paid'
         FROM generate_series(0, 3) m
       UNION ALL
       SELECT $1::bigint, 'expense'::txn_type, 900, CURRENT_DATE - 2, 'Travel'`, [u]);
    const cats = (await pool.query('SELECT category FROM v_recurring_expenses WHERE user_id = $1', [u])).rows.map((r) => r.category);
    assert.deepEqual(cats, ['Rent Paid']);
  });
  it('v_net_worth_summary returns a zero row for a user with nothing yet', async () => {
    const u = await makeUser();
    const r = await one<{ net_worth: string }>('SELECT net_worth FROM v_net_worth_summary WHERE user_id = $1', [u]);
    assert.equal(r.net_worth, '0');
  });
});

describe('EMI reminders', () => {
  it('are generated for an overdue installment, once', async () => {
    const u = await makeUser();
    await makeLoan(u, { start: '2025-01-01', tenure: 24 });
    await pool.query('SELECT fn_mark_overdue_emis($1)', [u]);
    const first = (await one<{ n: number }>('SELECT fn_generate_emi_reminders($1) AS n', [u])).n;
    const second = (await one<{ n: number }>('SELECT fn_generate_emi_reminders($1) AS n', [u])).n;
    assert.ok(first > 0);
    assert.equal(second, 0);
  });
});

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, makeUser, makeLoan, makeAsset, payFirst, one, rejectsWith } from '../helpers';
import { payInstallment } from '../../src/lib/db/loans';

after(() => pool.end());

describe('integrity constraints (CHECK / NOT NULL / UNIQUE)', () => {
  it('rejects a non-positive transaction amount (23514)', async () => {
    const u = await makeUser();
    await rejectsWith('23514', () => pool.query(
      `INSERT INTO transactions (user_id, txn_type, amount, txn_date) VALUES ($1, 'expense', -5, CURRENT_DATE)`, [u]));
  });
  it('rejects an interest rate above 60%', async () => {
    const u = await makeUser();
    await rejectsWith('23514', () => pool.query(
      `INSERT INTO loans (user_id, loan_type, lender, principal, interest_rate, tenure_months, start_date)
       VALUES ($1, 'home', 'X', 100000, 75, 12, CURRENT_DATE)`, [u]));
  });
  it('rejects a malformed PAN', async () => {
    await rejectsWith('23514', () => pool.query(
      `INSERT INTO users (name, email, password_hash, pan_number) VALUES ('P', 'pan-bad@test.dev', 'x', 'ABC123')`));
  });
  it('rejects a paid installment with no paid_date', async () => {
    const loan = await makeLoan(await makeUser());
    await rejectsWith('23514', () => pool.query(
      `UPDATE emi_schedule SET status = 'paid' WHERE loan_id = $1 AND installment_no = 1`, [loan]));
  });
  it('rejects a duplicate email (23505)', async () => {
    await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('A', 'dup@test.dev', 'x')`);
    await rejectsWith('23505', () => pool.query(
      `INSERT INTO users (name, email, password_hash) VALUES ('B', 'dup@test.dev', 'x')`));
  });
});

describe('EMI functions', () => {
  it('fn_calculate_emi matches the reducing-balance formula', async () => {
    const r = await one<{ emi: string }>('SELECT fn_calculate_emi(5000000, 8.5, 240) AS emi');
    assert.equal(r.emi, '43391.16');
  });
  it('handles a zero-interest loan without dividing by zero', async () => {
    const r = await one<{ emi: string }>('SELECT fn_calculate_emi(120000, 0, 12) AS emi');
    assert.equal(r.emi, '10000.00');
  });
  it('generated principal components sum exactly to the principal, ending at 0.00', async () => {
    const loan = await makeLoan(await makeUser(), { principal: 5_000_000, rate: 8.5, tenure: 240 });
    const r = await one<{ total: string; last: string; n: number }>(
      `SELECT SUM(principal_component) AS total, COUNT(*)::int AS n,
              (SELECT closing_balance FROM emi_schedule WHERE loan_id = $1 ORDER BY installment_no DESC LIMIT 1) AS last
         FROM emi_schedule WHERE loan_id = $1`, [loan]);
    assert.equal(r.total, '5000000.00');
    assert.equal(r.last, '0.00');
    assert.equal(r.n, 240);
  });
  it('refuses to regenerate a schedule once an installment is paid (WW409)', async () => {
    const loan = await makeLoan(await makeUser());
    await payFirst(loan, 1);
    await rejectsWith('WW409', () => pool.query('SELECT fn_generate_emi_schedule($1)', [loan]));
  });
});

describe('atomic EMI payment', () => {
  it('flips the installment, writes the ledger row and lowers outstanding by the principal part', async () => {
    const u = await makeUser();
    const loan = await makeLoan(u);
    const inst = await one<{ id: number; principal_component: string }>(
      'SELECT id, principal_component FROM emi_schedule WHERE loan_id = $1 AND installment_no = 1', [loan]);
    const before = Number((await one<{ o: string }>('SELECT fn_loan_outstanding($1) AS o', [loan])).o);

    const res = await payInstallment(u, inst.id);
    assert.ok(res);
    const after = Number((await one<{ o: string }>('SELECT fn_loan_outstanding($1) AS o', [loan])).o);
    assert.equal(Math.round((before - after) * 100), Math.round(Number(inst.principal_component) * 100));

    const ledger = await one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM transactions WHERE user_id = $1 AND related_loan_id = $2 AND txn_type = 'loan'`, [u, loan]);
    assert.equal(ledger.n, 1);
  });
  it('refuses to pay the same installment twice', async () => {
    const u = await makeUser();
    const loan = await makeLoan(u);
    const inst = await one<{ id: number }>('SELECT id FROM emi_schedule WHERE loan_id = $1 AND installment_no = 1', [loan]);
    assert.ok(await payInstallment(u, inst.id));
    assert.equal(await payInstallment(u, inst.id), null);
  });
  it("refuses to pay another user's installment", async () => {
    const owner = await makeUser();
    const intruder = await makeUser();
    const loan = await makeLoan(owner);
    const inst = await one<{ id: number }>('SELECT id FROM emi_schedule WHERE loan_id = $1 AND installment_no = 1', [loan]);
    assert.equal(await payInstallment(intruder, inst.id), null);
    const s = await one<{ status: string }>('SELECT status FROM emi_schedule WHERE id = $1', [inst.id]);
    assert.equal(s.status, 'pending');
  });
  it('closes the loan when the final installment is paid', async () => {
    const u = await makeUser();
    const loan = await makeLoan(u, { tenure: 2, principal: 20000 });
    const ids = (await pool.query<{ id: number }>('SELECT id FROM emi_schedule WHERE loan_id = $1 ORDER BY installment_no', [loan])).rows;
    for (const { id } of ids) await payInstallment(u, id);
    assert.equal((await one<{ status: string }>('SELECT status FROM loans WHERE id = $1', [loan])).status, 'closed');
  });
});

describe('net worth trigger', () => {
  it("adding an asset refreshes today's snapshot", async () => {
    const u = await makeUser();
    await makeAsset(u, 250000);
    const s = await one<{ total_assets: string }>(
      'SELECT total_assets FROM net_worth_snapshots WHERE user_id = $1 AND snapshot_date = CURRENT_DATE', [u]);
    assert.equal(s.total_assets, '250000.00');
  });
  it('a new loan appears as a liability', async () => {
    const u = await makeUser();
    await makeLoan(u, { principal: 400000 });
    const s = await one<{ total_liabilities: string }>(
      'SELECT total_liabilities FROM net_worth_snapshots WHERE user_id = $1 AND snapshot_date = CURRENT_DATE', [u]);
    assert.equal(s.total_liabilities, '400000.00');
  });
});

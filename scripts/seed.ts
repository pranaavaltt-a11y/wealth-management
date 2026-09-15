/**
 * Seeds realistic Indian demo data. Idempotent-ish: wipes the demo users first
 * (ON DELETE CASCADE clears their assets, loans, schedules and transactions),
 * then rebuilds. Reference data (loan_products) is upserted, not wiped.
 *
 *   npm run db:seed
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { Client } from 'pg';

const PASSWORD = 'password123';

const ASSETS: [string, string, number, number, string][] = [
  // name, type, purchase value, current value, purchase date
  ['Flat — Whitefield, Bengaluru',   'property',    6_500_000,  9_200_000, '2019-06-12'],
  ['Sovereign Gold Bond 2021-22',    'gold',          480_000,    742_000, '2021-08-09'],
  ['Gold jewellery (family)',        'gold',          320_000,    495_000, '2016-11-02'],
  ['EPF — corpus',                   'epf',         1_180_000,  1_180_000, '2015-07-01'],
  ['PPF — SBI',                      'ppf',           450_000,    612_000, '2018-04-05'],
  ['Nifty 50 Index Fund (UTI)',      'mutual_fund',   600_000,    913_000, '2020-02-18'],
  ['Parag Parikh Flexi Cap',         'mutual_fund',   350_000,    588_000, '2021-01-11'],
  ['HDFC Bank shares (250)',         'equity',        290_000,    421_000, '2020-09-30'],
  ['FD — Canara Bank (7.1%)',        'fd',            500_000,    536_000, '2023-03-15'],
  ['Maruti Baleno (2021)',           'vehicle',       820_000,    540_000, '2021-05-22'],
  ['Savings — HDFC / ICICI',         'cash',          185_000,    185_000, '2024-01-01'],
];

const LOANS: [string, string, number, number, string, number, string][] = [
  // lender, type, principal, rate, interest_type, tenure months, start date
  ['HDFC Bank',        'home',     5_200_000, 8.65, 'floating', 240, '2019-07-01'],
  ['ICICI Bank',       'vehicle',    650_000, 9.40, 'fixed',     60, '2021-06-01'],
  ['Bajaj Finserv',    'personal',   300_000, 14.50, 'fixed',    36, '2023-09-01'],
  ['SBI',              'education',  800_000, 8.15, 'floating', 120, '2022-08-01'],
];

const INCOME: [string, number, string][] = [
  ['Salary', 165_000, 'Monthly salary credit — Infosys'],
  ['Rent Received', 22_000, 'Tenant — 2BHK Kadugodi'],
  ['Dividend', 4_800, 'HDFC Bank interim dividend'],
];

const EXPENSES: [string, number, string][] = [
  ['Groceries', 14_500, 'BigBasket + local kirana'],
  ['Utilities', 3_400, 'BESCOM + water'],
  ['Mobile & Internet', 1_899, 'Jio Fiber + postpaid'],
  ['Fuel', 6_200, 'Petrol — Indian Oil'],
  ['Dining', 5_800, 'Weekend eating out'],
  ['Healthcare', 2_400, 'Apollo Pharmacy'],
  ['Education', 18_000, "Child's school fee"],
  ['Insurance', 4_100, 'LIC + health premium'],
  ['Household Help', 7_000, 'Cook + cleaning'],
  ['Shopping', 9_300, 'Myntra, Amazon'],
  ['Transport', 2_700, 'Auto / Uber'],
  ['Entertainment', 1_500, 'Streaming subscriptions'],
];

const LOAN_PRODUCTS: [string, string, string, number, number, number, number, number, number, number][] = [
  // lender, product, type, rate_min, rate_max, min_score, max_tenure, min_amt, max_amt, fee%
  ['HDFC Bank',      'HDFC Home Loan Adhaar',   'home',      8.35, 9.40, 700, 360,   500_000, 100_000_000, 0.50],
  ['SBI',            'SBI Regular Home Loan',   'home',      8.40, 9.65, 650, 360,   300_000,  75_000_000, 0.35],
  ['ICICI Bank',     'ICICI Home Advantage',    'home',      8.75, 9.85, 720, 300,   500_000,  50_000_000, 0.50],
  ['LIC Housing',    'Griha Suvidha',           'home',      8.50, 9.25, 680, 300,   400_000,  30_000_000, 0.25],
  ['SBI',            'SBI Car Loan',            'vehicle',   8.85, 9.90, 680,  84,   100_000,   5_000_000, 0.40],
  ['ICICI Bank',     'ICICI Auto Loan',         'vehicle',   9.10, 11.50, 650,  84,  100_000,   4_000_000, 0.75],
  ['Axis Bank',      'Axis Personal Loan',      'personal', 10.99, 18.00, 700,  60,    50_000,   4_000_000, 2.00],
  ['Bajaj Finserv',  'Insta Personal Loan',     'personal', 12.50, 22.00, 620,  48,    50_000,   2_500_000, 3.00],
  ['HDFC Bank',      'HDFC Personal Loan',      'personal', 10.75, 16.50, 720,  60,   100_000,   4_000_000, 2.50],
  ['SBI',            'SBI Global Ed-Vantage',   'education', 8.05, 10.15, 640, 180,   750_000,  15_000_000, 0.00],
  ['Bank of Baroda', 'Baroda Gold Loan',        'gold',      8.75, 10.50, 550,  36,    25_000,   2_500_000, 0.50],
  ['Muthoot Finance','Muthoot Gold Advance',    'gold',     11.00, 22.00, 500,  24,    10_000,   1_500_000, 1.00],
  ['Kotak Mahindra', 'Kotak Business Loan',     'business', 13.00, 19.50, 700,  48,   300_000,  10_000_000, 2.00],
];

function monthsBack(n: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

function shiftDay(iso: string, day: number): string {
  const d = new Date(iso);
  d.setDate(day);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');

  try {
    const hash = await bcrypt.hash(PASSWORD, 12);

    console.log('· clearing previous demo users');
    await client.query(
      `DELETE FROM users WHERE email IN ('priya@arthatrack.dev','rahul@arthatrack.dev','advisor@arthatrack.dev')`,
    );

    // ---------------------------------------------------------------- users
    const { rows: [advisor] } = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, password_hash, role, pan_number)
       VALUES ('Ananya Krishnan', 'advisor@arthatrack.dev', $1, 'advisor', 'AKRPS9182C')
       RETURNING id`,
      [hash],
    );
    const { rows: [priya] } = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, password_hash, role, pan_number, advisor_id)
       VALUES ('Priya Sharma', 'priya@arthatrack.dev', $1, 'individual', 'ABCPS1234K', $2)
       RETURNING id`,
      [hash, advisor.id],
    );
    const { rows: [rahul] } = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, password_hash, role, pan_number, advisor_id)
       VALUES ('Rahul Menon', 'rahul@arthatrack.dev', $1, 'individual', 'BXYPM5678L', $2)
       RETURNING id`,
      [hash, advisor.id],
    );
    console.log(`  users: advisor=${advisor.id} priya=${priya.id} rahul=${rahul.id}`);

    // --------------------------------------------------------------- assets
    for (const [name, type, pv, cv, date] of ASSETS) {
      await client.query(
        `INSERT INTO assets (user_id, name, asset_type, purchase_value, current_value, purchase_date, valuation_date)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE)`,
        [priya.id, name, type, pv, cv, date],
      );
    }
    // A smaller, younger portfolio for the second user.
    for (const [name, type, pv, cv, date] of ASSETS.slice(3, 8)) {
      await client.query(
        `INSERT INTO assets (user_id, name, asset_type, purchase_value, current_value, purchase_date, valuation_date)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE)`,
        [rahul.id, name, type, Math.round(pv * 0.4), Math.round(cv * 0.4), date],
      );
    }
    console.log(`  assets: ${ASSETS.length} + ${ASSETS.slice(3, 8).length}`);

    // ---------------------------------------------------- loans + schedules
    for (const [lender, type, principal, rate, itype, tenure, start] of LOANS) {
      const { rows: [loan] } = await client.query<{ id: number }>(
        `INSERT INTO loans (user_id, loan_type, lender, principal, interest_rate, interest_type,
                            tenure_months, start_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [priya.id, type, lender, principal, rate, itype, tenure, start],
      );
      // The stored procedure builds every installment row.
      await client.query('SELECT fn_generate_emi_schedule($1)', [loan.id]);

      // Mark everything already due as paid, so payoff progress is non-trivial.
      await client.query(
        `UPDATE emi_schedule
            SET status = 'paid', paid_date = due_date
          WHERE loan_id = $1 AND due_date < CURRENT_DATE`,
        [loan.id],
      );
    }
    await client.query(
      `INSERT INTO loans (user_id, loan_type, lender, principal, interest_rate, interest_type,
                          tenure_months, start_date)
       VALUES ($1, 'vehicle', 'Kotak Mahindra Bank', 450000, 9.75, 'fixed', 48, $2)`,
      [rahul.id, monthsBack(14)],
    );
    await client.query(
      `SELECT fn_generate_emi_schedule(id) FROM loans WHERE user_id = $1`, [rahul.id],
    );
    await client.query(
      `UPDATE emi_schedule e SET status = 'paid', paid_date = e.due_date
         FROM loans l WHERE e.loan_id = l.id AND l.user_id = $1 AND e.due_date < CURRENT_DATE`,
      [rahul.id],
    );
    // A loan whose every installment has cleared is closed — the same rule the
    // app applies when the final EMI is paid through the UI.
    await client.query(
      `UPDATE loans l
          SET status = 'closed'
        WHERE l.status = 'active'
          AND NOT EXISTS (
                SELECT 1 FROM emi_schedule e
                 WHERE e.loan_id = l.id AND e.status <> 'paid'
              )`,
    );
    console.log(`  loans: ${LOANS.length} + 1, schedules generated, fully-repaid ones closed`);

    // --------------------------------------------------------- transactions
    // 12 months of household income and spending, with a little variance so the
    // charts are not flat lines.
    let txnCount = 0;
    for (let m = 11; m >= 0; m--) {
      const month = monthsBack(m);
      for (const [category, base, description] of INCOME) {
        const amount = Math.round(base * (0.97 + Math.random() * 0.08));
        await client.query(
          `INSERT INTO transactions (user_id, txn_type, amount, txn_date, category, description, source)
           VALUES ($1, 'income', $2, $3, $4, $5, 'manual')`,
          [priya.id, amount, shiftDay(month, 1), category, description],
        );
        txnCount++;
      }
      for (const [category, base, description] of EXPENSES) {
        const amount = Math.round(base * (0.8 + Math.random() * 0.45));
        await client.query(
          `INSERT INTO transactions (user_id, txn_type, amount, txn_date, category, description, source)
           VALUES ($1, 'expense', $2, $3, $4, $5, 'manual')`,
          [priya.id, amount, shiftDay(month, 3 + Math.floor(Math.random() * 24)), category, description],
        );
        txnCount++;
      }
    }
    console.log(`  transactions: ${txnCount}`);

    // ------------------------------------------------------- loan_products
    for (const p of LOAN_PRODUCTS) {
      await client.query(
        `INSERT INTO loan_products (lender, product_name, loan_type, interest_rate_min, interest_rate_max,
                                    min_credit_score, max_tenure_months, min_amount, max_amount, processing_fee_pct)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (lender, product_name) DO UPDATE
           SET interest_rate_min = EXCLUDED.interest_rate_min,
               interest_rate_max = EXCLUDED.interest_rate_max,
               min_credit_score  = EXCLUDED.min_credit_score`,
        p,
      );
    }
    console.log(`  loan_products: ${LOAN_PRODUCTS.length}`);

    // ----------------------------------------------- historical net worth
    // The trigger only ever writes "today". Backfill a year of month-end
    // snapshots so the Phase 2 trend chart has a real series to draw.
    for (const uid of [priya.id, rahul.id]) {
      await client.query('SELECT fn_refresh_net_worth($1)', [uid]);
      const { rows: [now] } = await client.query<{ total_assets: string; total_liabilities: string }>(
        `SELECT total_assets, total_liabilities FROM net_worth_snapshots
          WHERE user_id = $1 ORDER BY snapshot_date DESC LIMIT 1`,
        [uid],
      );
      for (let m = 12; m >= 1; m--) {
        // Assets grow ~0.9%/month; liabilities shrink as EMIs were paid.
        const assets = Number(now.total_assets) / Math.pow(1.009, m);
        const liabilities = Number(now.total_liabilities) * (1 + m * 0.011);
        await client.query(
          `INSERT INTO net_worth_snapshots (user_id, snapshot_date, total_assets, total_liabilities, net_worth)
           VALUES ($1, (date_trunc('month', CURRENT_DATE) - ($2 || ' months')::INTERVAL)::date, $3, $4, $5)
           ON CONFLICT (user_id, snapshot_date) DO NOTHING`,
          [uid, m, assets.toFixed(2), liabilities.toFixed(2), (assets - liabilities).toFixed(2)],
        );
      }
    }
    console.log('  net worth snapshots: 13 months backfilled per user');

    await client.query('COMMIT');
    console.log(`\nSeed complete. Log in with any of:`);
    console.log(`  priya@arthatrack.dev   / ${PASSWORD}   (individual, full portfolio)`);
    console.log(`  rahul@arthatrack.dev   / ${PASSWORD}   (individual, smaller portfolio)`);
    console.log(`  advisor@arthatrack.dev / ${PASSWORD}   (advisor for both)`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

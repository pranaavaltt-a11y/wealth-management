import { query, queryOne, withTransaction, num } from './postgres';
import type { LoanInput } from '@/lib/validation/schemas';

export interface LoanRow {
  id: number;
  loan_type: string;
  lender: string;
  principal: string;
  interest_rate: string;
  interest_type: 'fixed' | 'floating';
  tenure_months: number;
  start_date: string;
  status: 'active' | 'closed' | 'defaulted';
  emi_amount: string | null;
  outstanding: string | null;
  paid_count: string | null;
  next_due_date: string | null;
}

export interface Loan {
  id: number;
  loanType: string;
  lender: string;
  principal: number;
  interestRate: number;
  interestType: 'fixed' | 'floating';
  tenureMonths: number;
  startDate: string;
  status: string;
  emiAmount: number;
  outstanding: number;
  paidCount: number;
  progressPct: number;
  nextDueDate: string | null;
}

function toLoan(r: LoanRow): Loan {
  const principal = num(r.principal);
  const outstanding = num(r.outstanding);
  return {
    id: r.id,
    loanType: r.loan_type,
    lender: r.lender,
    principal,
    interestRate: num(r.interest_rate),
    interestType: r.interest_type,
    tenureMonths: r.tenure_months,
    startDate: r.start_date,
    status: r.status,
    emiAmount: num(r.emi_amount),
    outstanding,
    paidCount: Number(r.paid_count ?? 0),
    progressPct: principal > 0 ? ((principal - outstanding) / principal) * 100 : 0,
    nextDueDate: r.next_due_date,
  };
}

/**
 * Loans joined to their amortisation table. The LEFT JOIN + GROUP BY collapses
 * up to 480 emi_schedule rows per loan into one summary row, and the
 * FILTER clauses do three different aggregates in a single pass over the join.
 */
const LOAN_SELECT = `
  SELECT l.id, l.loan_type, l.lender, l.principal, l.interest_rate, l.interest_type,
         l.tenure_months, l.start_date, l.status,
         MAX(e.emi_amount) FILTER (WHERE e.installment_no = 1)  AS emi_amount,
         fn_loan_outstanding(l.id)                              AS outstanding,
         COUNT(e.id) FILTER (WHERE e.status = 'paid')           AS paid_count,
         MIN(e.due_date) FILTER (WHERE e.status <> 'paid')      AS next_due_date
    FROM loans l
    LEFT JOIN emi_schedule e ON e.loan_id = l.id`;

export async function listLoans(userId: number): Promise<Loan[]> {
  const rows = await query<LoanRow>(
    `${LOAN_SELECT}
      WHERE l.user_id = $1
      GROUP BY l.id
      ORDER BY (l.status = 'active') DESC, l.start_date DESC`,
    [userId],
  );
  return rows.map(toLoan);
}

export async function getLoan(userId: number, id: number): Promise<Loan | null> {
  const row = await queryOne<LoanRow>(
    `${LOAN_SELECT}
      WHERE l.id = $1 AND l.user_id = $2
      GROUP BY l.id`,
    [id, userId],
  );
  return row ? toLoan(row) : null;
}

/**
 * Creating a loan and generating its 1..N installment rows happen inside ONE
 * transaction. If schedule generation throws, the loan row is rolled back too —
 * a loan without a schedule can never be observed.
 */
export async function createLoan(userId: number, input: LoanInput): Promise<Loan> {
  const id = await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO loans (user_id, loan_type, lender, principal, interest_rate,
                          interest_type, tenure_months, start_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        userId, input.loanType, input.lender, input.principal, input.interestRate,
        input.interestType, input.tenureMonths, input.startDate,
      ],
    );
    const loanId = rows[0].id;
    await client.query('SELECT fn_generate_emi_schedule($1)', [loanId]);
    return loanId;
  });

  const loan = await getLoan(userId, id);
  if (!loan) throw new Error('Loan disappeared immediately after creation.');
  return loan;
}

/** Editing loan terms regenerates the whole schedule — again, atomically. */
export async function updateLoan(userId: number, id: number, input: LoanInput): Promise<Loan | null> {
  const updated = await withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE loans
          SET loan_type = $3, lender = $4, principal = $5, interest_rate = $6,
              interest_type = $7, tenure_months = $8, start_date = $9
        WHERE id = $1 AND user_id = $2`,
      [
        id, userId, input.loanType, input.lender, input.principal, input.interestRate,
        input.interestType, input.tenureMonths, input.startDate,
      ],
    );
    if (!rowCount) return false;
    await client.query('SELECT fn_generate_emi_schedule($1)', [id]);
    return true;
  });
  return updated ? getLoan(userId, id) : null;
}

export async function setLoanStatus(userId: number, id: number, status: 'active' | 'closed' | 'defaulted') {
  const rows = await query(
    `UPDATE loans SET status = $3 WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId, status],
  );
  return rows.length > 0;
}

export async function deleteLoan(userId: number, id: number): Promise<boolean> {
  // emi_schedule rows go with it via ON DELETE CASCADE.
  const rows = await query(`DELETE FROM loans WHERE id = $1 AND user_id = $2 RETURNING id`, [id, userId]);
  return rows.length > 0;
}

// --------------------------------------------------------------- EMI schedule

export interface Installment {
  id: number;
  installmentNo: number;
  dueDate: string;
  emiAmount: number;
  principalComponent: number;
  interestComponent: number;
  closingBalance: number;
  status: string;
  paidDate: string | null;
}

export async function getSchedule(userId: number, loanId: number): Promise<Installment[]> {
  const rows = await query<Record<string, string>>(
    `SELECT e.id, e.installment_no, e.due_date, e.emi_amount, e.principal_component,
            e.interest_component, e.closing_balance, e.status, e.paid_date
       FROM emi_schedule e
       JOIN loans l ON l.id = e.loan_id
      WHERE e.loan_id = $1 AND l.user_id = $2   -- ownership enforced in the JOIN
      ORDER BY e.installment_no`,
    [loanId, userId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    installmentNo: Number(r.installment_no),
    dueDate: r.due_date,
    emiAmount: num(r.emi_amount),
    principalComponent: num(r.principal_component),
    interestComponent: num(r.interest_component),
    closingBalance: num(r.closing_balance),
    status: r.status,
    paidDate: r.paid_date,
  }));
}

/**
 * Marking an installment paid, atomically:
 *   1. flip the installment to 'paid'
 *   2. record the outflow in transactions
 *   3. close the loan if this was the last installment
 * The net worth snapshot refresh happens automatically via trg_emi_net_worth.
 */
export async function payInstallment(userId: number, installmentId: number) {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{
      id: number; loan_id: number; emi_amount: string; installment_no: number; lender: string;
    }>(
      `UPDATE emi_schedule e
          SET status = 'paid', paid_date = CURRENT_DATE
         FROM loans l
        WHERE e.id = $1
          AND e.loan_id = l.id
          AND l.user_id = $2
          AND e.status <> 'paid'
        RETURNING e.id, e.loan_id, e.emi_amount, e.installment_no, l.lender`,
      [installmentId, userId],
    );
    if (rows.length === 0) return null;   // not found, not owned, or already paid
    const paid = rows[0];

    await client.query(
      `INSERT INTO transactions (user_id, txn_type, amount, txn_date, category, description,
                                 source, related_loan_id)
       VALUES ($1, 'loan', $2, CURRENT_DATE, 'EMI Payment', $3, 'manual', $4)`,
      [userId, paid.emi_amount, `EMI #${paid.installment_no} — ${paid.lender}`, paid.loan_id],
    );

    await client.query(
      `UPDATE loans
          SET status = 'closed'
        WHERE id = $1
          AND NOT EXISTS (SELECT 1 FROM emi_schedule WHERE loan_id = $1 AND status <> 'paid')`,
      [paid.loan_id],
    );

    return { installmentId: paid.id, loanId: paid.loan_id, amount: num(paid.emi_amount) };
  });
}

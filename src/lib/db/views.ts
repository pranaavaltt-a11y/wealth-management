import { query, queryOne, num } from './postgres';

/**
 * Reads against the Phase 2 reporting views (db/migrations/005).
 *
 * The aggregation lives in the view, not here — these functions select from a
 * view and marshal types. That keeps one definition of "what allocation means"
 * shared by the dashboard, the advisor screen and any future report.
 */

// ------------------------------------------------------ net worth summary

export interface NetWorthSummary {
  totalAssets: number;
  liquidAssets: number;
  assetCount: number;
  totalLiabilities: number;
  activeLoanCount: number;
  monthlyEmiBurden: number;
  netWorth: number;
  debtToAssetPct: number | null;
}

export async function netWorthSummary(userId: number): Promise<NetWorthSummary> {
  const r = await queryOne<Record<string, string | null>>(
    `SELECT total_assets, liquid_assets, asset_count, total_liabilities,
            active_loan_count, monthly_emi_burden, net_worth, debt_to_asset_pct
       FROM v_net_worth_summary
      WHERE user_id = $1`,
    [userId],
  );
  return {
    totalAssets: num(r?.total_assets),
    liquidAssets: num(r?.liquid_assets),
    assetCount: Number(r?.asset_count ?? 0),
    totalLiabilities: num(r?.total_liabilities),
    activeLoanCount: Number(r?.active_loan_count ?? 0),
    monthlyEmiBurden: num(r?.monthly_emi_burden),
    netWorth: num(r?.net_worth),
    debtToAssetPct: r?.debt_to_asset_pct === null || r?.debt_to_asset_pct === undefined
      ? null
      : num(r.debt_to_asset_pct),
  };
}

// -------------------------------------------------------- upcoming dues

export type Urgency = 'overdue' | 'due_this_week' | 'due_this_month' | 'upcoming';

export interface UpcomingDue {
  installmentId: number;
  loanId: number;
  lender: string;
  loanType: string;
  installmentNo: number;
  dueDate: string;
  emiAmount: number;
  principalComponent: number;
  interestComponent: number;
  daysUntilDue: number;
  urgency: Urgency;
  status: string;
}

/** Flips past-due pending installments to 'overdue' before reading the view. */
export async function markOverdue(userId: number): Promise<number> {
  const r = await queryOne<{ fn_mark_overdue_emis: number }>(
    'SELECT fn_mark_overdue_emis($1)', [userId],
  );
  return Number(r?.fn_mark_overdue_emis ?? 0);
}

export async function upcomingDues(userId: number, withinDays = 45, limit = 12): Promise<UpcomingDue[]> {
  const rows = await query<Record<string, string>>(
    `SELECT installment_id, loan_id, lender, loan_type, installment_no, due_date,
            emi_amount, principal_component, interest_component, days_until_due,
            urgency, status
       FROM v_upcoming_emi_dues
      WHERE user_id = $1
        AND days_until_due <= $2
      ORDER BY due_date
      LIMIT $3`,
    [userId, withinDays, limit],
  );
  return rows.map((r) => ({
    installmentId: Number(r.installment_id),
    loanId: Number(r.loan_id),
    lender: r.lender,
    loanType: r.loan_type,
    installmentNo: Number(r.installment_no),
    dueDate: r.due_date,
    emiAmount: num(r.emi_amount),
    principalComponent: num(r.principal_component),
    interestComponent: num(r.interest_component),
    daysUntilDue: Number(r.days_until_due),
    urgency: r.urgency as Urgency,
    status: r.status,
  }));
}

// ------------------------------------------------------ asset allocation

export interface Allocation {
  assetType: string;
  holdings: number;
  invested: number;
  currentValue: number;
  unrealisedGain: number;
  gainPct: number | null;
  allocationPct: number;
}

export async function allocation(userId: number): Promise<Allocation[]> {
  const rows = await query<Record<string, string | null>>(
    `SELECT asset_type, holdings, invested, current_value, unrealised_gain,
            gain_pct, allocation_pct
       FROM v_asset_allocation
      WHERE user_id = $1
      ORDER BY current_value DESC`,
    [userId],
  );
  return rows.map((r) => ({
    assetType: r.asset_type as string,
    holdings: Number(r.holdings),
    invested: num(r.invested),
    currentValue: num(r.current_value),
    unrealisedGain: num(r.unrealised_gain),
    gainPct: r.gain_pct === null ? null : num(r.gain_pct),
    allocationPct: num(r.allocation_pct),
  }));
}

// --------------------------------------------------- loan payoff progress

export interface PayoffRow {
  loanId: number;
  lender: string;
  loanType: string;
  interestType: string;
  principal: number;
  interestRate: number;
  tenureMonths: number;
  status: string;
  totalInstallments: number;
  paidInstallments: number;
  overdueInstallments: number;
  principalRepaid: number;
  interestPaid: number;
  totalInterest: number;
  outstanding: number;
  nextDueDate: string | null;
  finalDueDate: string | null;
  tenureProgressPct: number;
  principalProgressPct: number;
}

export async function loanPayoffProgress(userId: number): Promise<PayoffRow[]> {
  const rows = await query<Record<string, string | null>>(
    `SELECT loan_id, lender, loan_type, interest_type, principal, interest_rate,
            tenure_months, status, total_installments, paid_installments,
            overdue_installments, principal_repaid, interest_paid, total_interest,
            outstanding, next_due_date, final_due_date, tenure_progress_pct,
            principal_progress_pct
       FROM v_loan_payoff_progress
      WHERE user_id = $1
      ORDER BY (status = 'active') DESC, outstanding DESC`,
    [userId],
  );
  return rows.map((r) => ({
    loanId: Number(r.loan_id),
    lender: r.lender as string,
    loanType: r.loan_type as string,
    interestType: r.interest_type as string,
    principal: num(r.principal),
    interestRate: num(r.interest_rate),
    tenureMonths: Number(r.tenure_months),
    status: r.status as string,
    totalInstallments: Number(r.total_installments),
    paidInstallments: Number(r.paid_installments),
    overdueInstallments: Number(r.overdue_installments),
    principalRepaid: num(r.principal_repaid),
    interestPaid: num(r.interest_paid),
    totalInterest: num(r.total_interest),
    outstanding: num(r.outstanding),
    nextDueDate: r.next_due_date,
    finalDueDate: r.final_due_date,
    tenureProgressPct: num(r.tenure_progress_pct),
    principalProgressPct: num(r.principal_progress_pct),
  }));
}

// -------------------------------------------------------- monthly cashflow

export interface CashflowMonth {
  month: string;
  income: number;
  expense: number;
  net: number;
  cumulativeNet: number;
}

export async function monthlyCashflow(userId: number, months = 12): Promise<CashflowMonth[]> {
  const rows = await query<Record<string, string>>(
    `SELECT month, income, expense, net, cumulative_net
       FROM v_monthly_cashflow
      WHERE user_id = $1
        AND month >= date_trunc('month', CURRENT_DATE) - ($2 || ' months')::INTERVAL
      ORDER BY month`,
    [userId, months - 1],
  );
  return rows.map((r) => ({
    month: r.month,
    income: num(r.income),
    expense: num(r.expense),
    net: num(r.net),
    cumulativeNet: num(r.cumulative_net),
  }));
}

// ------------------------------------------------------- category spending

export interface CategorySpend {
  category: string;
  txnCount: number;
  total: number;
  sharePct: number;
}

export async function categorySpend(userId: number, month: string): Promise<CategorySpend[]> {
  const rows = await query<Record<string, string>>(
    `SELECT category, txn_count, total, share_pct
       FROM v_category_spend
      WHERE user_id = $1 AND month = date_trunc('month', $2::date)::date
      ORDER BY total DESC`,
    [userId, month],
  );
  return rows.map((r) => ({
    category: r.category,
    txnCount: Number(r.txn_count),
    total: num(r.total),
    sharePct: num(r.share_pct),
  }));
}

// ----------------------------------------------------- recurring expenses

export interface RecurringExpense {
  category: string;
  monthsSeen: number;
  txnCount: number;
  avgAmount: number;
  minAmount: number;
  maxAmount: number;
  totalSpent: number;
  monthlyRunRate: number;
}

/** Backed by the HAVING-filtered view: categories seen in 3+ distinct months. */
export async function recurringExpenses(userId: number, limit = 8): Promise<RecurringExpense[]> {
  const rows = await query<Record<string, string>>(
    `SELECT category, months_seen, txn_count, avg_amount, min_amount,
            max_amount, total_spent, monthly_run_rate
       FROM v_recurring_expenses
      WHERE user_id = $1
      ORDER BY monthly_run_rate DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    category: r.category,
    monthsSeen: Number(r.months_seen),
    txnCount: Number(r.txn_count),
    avgAmount: num(r.avg_amount),
    minAmount: num(r.min_amount),
    maxAmount: num(r.max_amount),
    totalSpent: num(r.total_spent),
    monthlyRunRate: num(r.monthly_run_rate),
  }));
}

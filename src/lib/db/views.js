import { query, queryOne, num } from './postgres';

/**
 * Reads against the Phase 2 reporting views (db/migrations/005).
 *
 * The aggregation lives in the view, not here — these functions select from a
 * view and marshal types. That keeps one definition of "what allocation means"
 * shared by the dashboard, the advisor screen and any future report.
 *
 * @typedef {object} NetWorthSummary
 * @property {number} totalAssets
 * @property {number} liquidAssets
 * @property {number} assetCount
 * @property {number} totalLiabilities
 * @property {number} activeLoanCount
 * @property {number} monthlyEmiBurden
 * @property {number} netWorth
 * @property {number | null} debtToAssetPct
 */

/**
 * @param {number} userId
 * @returns {Promise<NetWorthSummary>}
 */
export async function netWorthSummary(userId) {
  const r = await queryOne(
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
    debtToAssetPct:
      r?.debt_to_asset_pct === null || r?.debt_to_asset_pct === undefined ? null : num(r.debt_to_asset_pct),
  };
}

// -------------------------------------------------------- upcoming dues

/**
 * @typedef {'overdue' | 'due_this_week' | 'due_this_month' | 'upcoming'} Urgency
 */

/**
 * @typedef {object} UpcomingDue
 * @property {number} installmentId
 * @property {number} loanId
 * @property {string} lender
 * @property {string} loanType
 * @property {number} installmentNo
 * @property {string} dueDate
 * @property {number} emiAmount
 * @property {number} principalComponent
 * @property {number} interestComponent
 * @property {number} daysUntilDue
 * @property {Urgency} urgency
 * @property {string} status
 */

/**
 * Flips past-due pending installments to 'overdue' before reading the view.
 *
 * @param {number} userId
 * @returns {Promise<number>}
 */
export async function markOverdue(userId) {
  const r = await queryOne('SELECT fn_mark_overdue_emis($1)', [userId]);
  return Number(r?.fn_mark_overdue_emis ?? 0);
}

/**
 * @param {number} userId
 * @param {number} [withinDays=45]
 * @param {number} [limit=12]
 * @returns {Promise<UpcomingDue[]>}
 */
export async function upcomingDues(userId, withinDays = 45, limit = 12) {
  const rows = await query(
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
    urgency: r.urgency,
    status: r.status,
  }));
}

// ------------------------------------------------------ asset allocation

/**
 * @typedef {object} Allocation
 * @property {string} assetType
 * @property {number} holdings
 * @property {number} invested
 * @property {number} currentValue
 * @property {number} unrealisedGain
 * @property {number | null} gainPct
 * @property {number} allocationPct
 */

/**
 * @param {number} userId
 * @returns {Promise<Allocation[]>}
 */
export async function allocation(userId) {
  const rows = await query(
    `SELECT asset_type, holdings, invested, current_value, unrealised_gain,
            gain_pct, allocation_pct
       FROM v_asset_allocation
      WHERE user_id = $1
      ORDER BY current_value DESC`,
    [userId],
  );
  return rows.map((r) => ({
    assetType: r.asset_type,
    holdings: Number(r.holdings),
    invested: num(r.invested),
    currentValue: num(r.current_value),
    unrealisedGain: num(r.unrealised_gain),
    gainPct: r.gain_pct === null ? null : num(r.gain_pct),
    allocationPct: num(r.allocation_pct),
  }));
}

// --------------------------------------------------- loan payoff progress

/**
 * @typedef {object} PayoffRow
 * @property {number} loanId
 * @property {string} lender
 * @property {string} loanType
 * @property {string} interestType
 * @property {number} principal
 * @property {number} interestRate
 * @property {number} tenureMonths
 * @property {string} status
 * @property {number} totalInstallments
 * @property {number} paidInstallments
 * @property {number} overdueInstallments
 * @property {number} principalRepaid
 * @property {number} interestPaid
 * @property {number} totalInterest
 * @property {number} outstanding
 * @property {string | null} nextDueDate
 * @property {string | null} finalDueDate
 * @property {number} tenureProgressPct
 * @property {number} principalProgressPct
 */

/**
 * @param {number} userId
 * @returns {Promise<PayoffRow[]>}
 */
export async function loanPayoffProgress(userId) {
  const rows = await query(
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
    lender: r.lender,
    loanType: r.loan_type,
    interestType: r.interest_type,
    principal: num(r.principal),
    interestRate: num(r.interest_rate),
    tenureMonths: Number(r.tenure_months),
    status: r.status,
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

/**
 * @typedef {object} CashflowMonth
 * @property {string} month
 * @property {number} income
 * @property {number} expense
 * @property {number} net
 * @property {number} cumulativeNet
 */

/**
 * @param {number} userId
 * @param {number} [months=12]
 * @returns {Promise<CashflowMonth[]>}
 */
export async function monthlyCashflow(userId, months = 12) {
  const rows = await query(
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

/**
 * @typedef {object} CategorySpend
 * @property {string} category
 * @property {number} txnCount
 * @property {number} total
 * @property {number} sharePct
 */

/**
 * @param {number} userId
 * @param {string} month
 * @returns {Promise<CategorySpend[]>}
 */
export async function categorySpend(userId, month) {
  const rows = await query(
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

/**
 * @typedef {object} RecurringExpense
 * @property {string} category
 * @property {number} monthsSeen
 * @property {number} txnCount
 * @property {number} avgAmount
 * @property {number} minAmount
 * @property {number} maxAmount
 * @property {number} totalSpent
 * @property {number} monthlyRunRate
 */

/**
 * Backed by the HAVING-filtered view: categories seen in 3+ distinct months.
 *
 * @param {number} userId
 * @param {number} [limit=8]
 * @returns {Promise<RecurringExpense[]>}
 */
export async function recurringExpenses(userId, limit = 8) {
  const rows = await query(
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

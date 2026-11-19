import { query, queryOne, pool, num } from './postgres';

/**
 * Phase 4 and 5 reads and writes. Every function is a thin call into a
 * database function, procedure or view from migration 008 — the logic itself
 * lives in SQL, where it can be shown and explained.
 *
 * @typedef {object} ScoreFactor
 * @property {string} key
 * @property {number} weight
 * @property {number} value
 */
/**
 * @typedef {object} CreditScore
 * @property {number} score
 * @property {string} computedDate
 * @property {ScoreFactor[]} factors
 * @property {Record<string, number | null>} inputs
 * @property {string} disclaimer
 */

/**
 * @param {{ score: number, computed_date: string, factors_json: Record<string, unknown> }} r
 * @returns {CreditScore}
 */
function toScore(r) {
  const f = r.factors_json.factors ?? {};
  return {
    score: Number(r.score),
    computedDate: r.computed_date,
    // JSONB does not preserve key order, so present factors by weight.
    factors: Object.entries(f)
      .map(([key, v]) => ({ key, weight: num(v.weight), value: num(v.value) }))
      .sort((a, b) => b.weight - a.weight),
    inputs: r.factors_json.inputs ?? {},
    disclaimer: String(r.factors_json.disclaimer ?? ''),
  };
}

/**
 * Recomputes today's score, then returns it with its 13-month history.
 *
 * @param {number} userId
 */
export async function creditScore(userId) {
  await query('SELECT fn_compute_credit_score($1)', [userId]);
  const rows = await query(
    `SELECT score, computed_date, factors_json
       FROM credit_score_history
      WHERE user_id = $1
      ORDER BY computed_date`,
    [userId],
  );
  if (rows.length === 0) return null;
  return {
    current: toScore(rows[rows.length - 1]),
    history: rows.map((r) => ({ date: r.computed_date, score: Number(r.score) })),
  };
}

// ------------------------------------------------------ recommendations

/**
 * @typedef {object} Recommendation
 * @property {number} productId
 * @property {string} lender
 * @property {string} productName
 * @property {boolean} eligible
 * @property {string[]} reasons
 * @property {number} estimatedRate
 * @property {number} tenureMonths
 * @property {number} estimatedEmi
 * @property {number} processingFee
 * @property {number} totalCost
 * @property {number | null} foirPct
 * @property {number} matchScore
 */

/**
 * @param {number} userId
 * @param {string} loanType
 * @param {number} amount
 * @param {number} tenureMonths
 */
export async function recommend(userId, loanType, amount, tenureMonths) {
  const rows = await query('SELECT * FROM fn_recommend_loan_products($1, $2::loan_type, $3, $4)', [
    userId,
    loanType,
    amount,
    tenureMonths,
  ]);
  return rows.map((r) => ({
    productId: Number(r.product_id),
    lender: String(r.lender),
    productName: String(r.product_name),
    eligible: Boolean(r.eligible),
    reasons: r.reasons ?? [],
    estimatedRate: num(r.estimated_rate),
    tenureMonths: Number(r.tenure_months),
    estimatedEmi: num(r.estimated_emi),
    processingFee: num(r.processing_fee),
    totalCost: num(r.total_cost),
    foirPct: r.foir_pct === null ? null : num(r.foir_pct),
    matchScore: num(r.match_score),
  }));
}

// ----------------------------------------------------------- prepayment

/**
 * @typedef {object} PrepaySummary
 * @property {'reduce_tenure' | 'reduce_emi'} mode
 * @property {number} installmentsLeft
 * @property {number} newEmi
 * @property {number} totalInterest
 * @property {number} interestSaved
 * @property {number} monthsSaved
 * @property {string | null} newEndDate
 */

/**
 * Both modes side by side, against the current schedule, in ONE query: the
 * three CTEs read the same snapshot, so the comparison is consistent even if
 * an installment is being paid concurrently. Ownership is enforced in the
 * `owned` CTE — a loan that is not this user's yields no rows.
 *
 * @param {number} userId
 * @param {number} loanId
 * @param {number} amount
 */
export async function simulatePrepayment(userId, loanId, amount) {
  const row = await queryOne(
    `WITH owned AS (
       SELECT id FROM loans WHERE id = $1 AND user_id = $2
     ),
     current AS (
       SELECT COUNT(*) AS n, SUM(e.interest_component) AS interest, MAX(e.due_date) AS end_date,
              (SELECT e2.emi_amount FROM emi_schedule e2 WHERE e2.loan_id = $1 AND e2.status <> 'paid'
                ORDER BY e2.installment_no LIMIT 1) AS emi
         FROM emi_schedule e JOIN owned o ON o.id = e.loan_id
        WHERE e.status <> 'paid'
     ),
     tenure AS (
       SELECT COUNT(*) AS n, SUM(interest_component) AS interest, MAX(due_date) AS end_date,
              MIN(emi_amount) FILTER (WHERE installment_no = (SELECT MIN(installment_no)
                FROM fn_simulate_prepayment($1, $3, 'reduce_tenure'))) AS emi
         FROM fn_simulate_prepayment($1, $3, 'reduce_tenure')
        WHERE EXISTS (SELECT 1 FROM owned)
     ),
     emi AS (
       SELECT COUNT(*) AS n, SUM(interest_component) AS interest, MAX(due_date) AS end_date,
              MIN(emi_amount) FILTER (WHERE installment_no = (SELECT MIN(installment_no)
                FROM fn_simulate_prepayment($1, $3, 'reduce_emi'))) AS emi
         FROM fn_simulate_prepayment($1, $3, 'reduce_emi')
        WHERE EXISTS (SELECT 1 FROM owned)
     )
     SELECT c.n AS cur_n, c.interest AS cur_interest, c.end_date AS cur_end, c.emi AS cur_emi,
            t.n AS ten_n, t.interest AS ten_interest, t.end_date AS ten_end, t.emi AS ten_emi,
            e.n AS emi_n, e.interest AS emi_interest, e.end_date AS emi_end, e.emi AS emi_emi,
            fn_loan_outstanding($1) AS outstanding
       FROM current c, tenure t, emi e
      WHERE EXISTS (SELECT 1 FROM owned)`,
    [loanId, userId, amount],
  );
  if (!row) return null;

  const curN = Number(row.cur_n);
  const curInterest = num(row.cur_interest);
  const make = (mode, n, interest, end, emi) => ({
    mode,
    installmentsLeft: Number(n ?? 0),
    newEmi: num(emi),
    totalInterest: num(interest),
    interestSaved: curInterest - num(interest),
    monthsSaved: curN - Number(n ?? 0),
    newEndDate: end,
  });

  return {
    outstanding: num(row.outstanding),
    current: {
      installmentsLeft: curN,
      emi: num(row.cur_emi),
      totalInterest: curInterest,
      endDate: row.cur_end,
    },
    reduceTenure: make('reduce_tenure', row.ten_n, row.ten_interest, row.ten_end, row.ten_emi),
    reduceEmi: make('reduce_emi', row.emi_n, row.emi_interest, row.emi_end, row.emi_emi),
  };
}

/**
 * CALLs the stored procedure. A procedure call is a single atomic statement.
 *
 * @param {number} userId
 * @param {number} loanId
 * @param {number} amount
 * @param {'reduce_tenure' | 'reduce_emi'} mode
 * @param {number | null} fromAssetId
 * @returns {Promise<{ interestSaved: number }>}
 */
export async function applyPrepayment(userId, loanId, amount, mode, fromAssetId) {
  const res = await pool.query('CALL sp_apply_prepayment($1, $2, $3, $4, $5, NULL)', [
    userId,
    loanId,
    amount,
    mode,
    fromAssetId,
  ]);
  return { interestSaved: num(res.rows[0]?.p_interest_saved) };
}

// ------------------------------------------------------------ projection

/**
 * @param {number} userId
 * @param {number} months
 * @param {number | null} closeLoanId
 * @param {number} growthPct
 */
export async function projectNetWorth(userId, months, closeLoanId, growthPct) {
  const rows = await query('SELECT * FROM fn_project_net_worth($1, $2, $3, $4)', [
    userId,
    months,
    closeLoanId,
    growthPct,
  ]);
  return rows.map((r) => ({
    monthOffset: Number(r.month_offset),
    month: r.month,
    assets: num(r.assets),
    liabilities: num(r.liabilities),
    netWorth: num(r.net_worth),
    scenarioAssets: num(r.scenario_assets),
    scenarioLiabilities: num(r.scenario_liabilities),
    scenarioNetWorth: num(r.scenario_net_worth),
  }));
}

// --------------------------------------------------------- notifications

/**
 * @param {number} userId
 * @param {number} [limit=30]
 */
export async function notifications(userId, limit = 30) {
  // Generating on read keeps reminders current without a cron job. It is
  // idempotent (a partial unique index), so repeated reads add nothing.
  await query('SELECT fn_mark_overdue_emis($1)', [userId]);
  await query('SELECT fn_generate_emi_reminders($1)', [userId]);
  const rows = await query(
    `SELECT id, kind, title, body, due_date, is_read, created_at
       FROM notifications
      WHERE user_id = $1
      ORDER BY is_read, created_at DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    kind: String(r.kind),
    title: String(r.title),
    body: String(r.body),
    dueDate: r.due_date,
    isRead: Boolean(r.is_read),
    createdAt: String(r.created_at),
  }));
}

/**
 * @param {number} userId
 * @param {number} [id]
 */
export async function markNotificationsRead(userId, id) {
  await query(
    `UPDATE notifications SET is_read = TRUE
      WHERE user_id = $1 AND NOT is_read AND ($2::bigint IS NULL OR id = $2)`,
    [userId, id ?? null],
  );
}

/**
 * @param {number} userId
 * @returns {Promise<number>}
 */
export async function unreadCount(userId) {
  const r = await queryOne('SELECT COUNT(*) AS n FROM notifications WHERE user_id = $1 AND NOT is_read', [
    userId,
  ]);
  return Number(r?.n ?? 0);
}

// ---------------------------------------------------------- FY reporting

/**
 * @param {number} userId
 * @returns {Promise<{ startYear: number, label: string }[]>}
 */
export async function fyYears(userId) {
  const rows = await query(
    `SELECT DISTINCT fy_start_year, fy_label FROM v_fy_summary
      WHERE user_id = $1 ORDER BY fy_start_year DESC`,
    [userId],
  );
  return rows.map((r) => ({ startYear: Number(r.fy_start_year), label: r.fy_label }));
}

/**
 * @param {number} userId
 * @param {number} startYear
 */
export async function fyReport(userId, startYear) {
  const [summary, categories, loans, tax, monthly] = await Promise.all([
    queryOne('SELECT * FROM v_fy_summary WHERE user_id = $1 AND fy_start_year = $2', [userId, startYear]),
    query(
      `SELECT category, txn_count, total, share_pct FROM v_fy_category_spend
        WHERE user_id = $1 AND fy_start_year = $2 ORDER BY total DESC`,
      [userId, startYear],
    ),
    query(
      `SELECT lender, loan_type, emis_paid, total_paid, principal_repaid, interest_paid
         FROM v_fy_loan_summary WHERE user_id = $1 AND fy_start_year = $2 ORDER BY total_paid DESC`,
      [userId, startYear],
    ),
    queryOne('SELECT * FROM v_fy_tax_hints WHERE user_id = $1 AND fy_start_year = $2', [userId, startYear]),
    // Month-by-month within the FY, April first — uses the expression index.
    query(
      `SELECT date_trunc('month', txn_date)::date AS month,
              COALESCE(SUM(amount) FILTER (WHERE txn_type = 'income'), 0)  AS income,
              COALESCE(SUM(amount) FILTER (WHERE txn_type = 'expense'), 0) AS expense
         FROM transactions
        WHERE user_id = $1 AND fn_fy_start_year(txn_date) = $2
        GROUP BY 1 ORDER BY 1`,
      [userId, startYear],
    ),
  ]);

  return {
    startYear,
    label: summary?.fy_label ?? `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
    summary: summary && {
      income: num(summary.income),
      expense: num(summary.expense),
      loanOutflow: num(summary.loan_outflow),
      txnCount: Number(summary.txn_count),
      savingsRatePct: summary.savings_rate_pct === null ? null : num(summary.savings_rate_pct),
    },
    categories: categories.map((c) => ({
      category: c.category,
      txnCount: Number(c.txn_count),
      total: num(c.total),
      sharePct: num(c.share_pct),
    })),
    loans: loans.map((l) => ({
      lender: l.lender,
      loanType: l.loan_type,
      emisPaid: Number(l.emis_paid),
      totalPaid: num(l.total_paid),
      principalRepaid: num(l.principal_repaid),
      interestPaid: num(l.interest_paid),
    })),
    tax: tax && {
      sec24b: num(tax.sec24b_home_interest),
      sec80c: num(tax.sec80c_home_principal),
      sec80e: num(tax.sec80e_education_interest),
    },
    monthly: monthly.map((m) => ({ month: m.month, income: num(m.income), expense: num(m.expense) })),
  };
}

// ---------------------------------------------------------- advisor view

/**
 * Clients assigned to an advisor, with the signals an advisor triages by.
 *
 * @param {number} advisorId
 */
export async function advisorClients(advisorId) {
  const rows = await query(
    `SELECT u.id, u.name, u.email,
            s.net_worth, s.total_assets, s.total_liabilities, s.debt_to_asset_pct,
            s.active_loan_count, s.monthly_emi_burden,
            cs.score,
            (SELECT COUNT(*) FROM v_upcoming_emi_dues d
              WHERE d.user_id = u.id AND d.urgency = 'overdue') AS overdue
       FROM users u
       JOIN v_net_worth_summary s ON s.user_id = u.id
       LEFT JOIN LATERAL (
            SELECT c.score FROM credit_score_history c
             WHERE c.user_id = u.id ORDER BY c.computed_date DESC LIMIT 1
       ) cs ON TRUE
      WHERE u.advisor_id = $1
      ORDER BY overdue DESC, u.name`,
    [advisorId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    email: String(r.email),
    netWorth: num(r.net_worth),
    totalAssets: num(r.total_assets),
    totalLiabilities: num(r.total_liabilities),
    debtToAssetPct: r.debt_to_asset_pct === null ? null : num(r.debt_to_asset_pct),
    activeLoans: Number(r.active_loan_count),
    monthlyEmi: num(r.monthly_emi_burden),
    score: r.score === null ? null : Number(r.score),
    overdue: Number(r.overdue),
  }));
}

// ------------------------------------------------------ news rate impact

/**
 * The Postgres half of "how does this news affect my loans?". The article (a
 * Mongo document) supplies a rate change in basis points; this applies it to
 * every active FLOATING-rate loan the user holds and reprices the remaining
 * schedule with fn_calculate_emi.
 *
 * Both EMIs are recomputed on the same outstanding balance and remaining
 * tenure, so the difference is purely the rate change rather than rounding
 * drift in the stored schedule. Assumes full pass-through: true of
 * repo-linked (EBLR) loans at their next reset; MCLR loans follow with a lag.
 *
 * @param {number} userId
 * @param {number} bps
 */
export async function rateImpact(userId, bps) {
  const rows = await query(
    `SELECT l.id, l.lender, l.loan_type, l.interest_rate,
            l.interest_rate + $2 / 100.0                                       AS new_rate,
            o.outstanding, r.remaining,
            fn_calculate_emi(o.outstanding, l.interest_rate,              r.remaining::int) AS old_emi,
            fn_calculate_emi(o.outstanding, l.interest_rate + $2 / 100.0, r.remaining::int) AS new_emi
       FROM loans l
      CROSS JOIN LATERAL (SELECT fn_loan_outstanding(l.id) AS outstanding) o
      CROSS JOIN LATERAL (SELECT COUNT(*) AS remaining FROM emi_schedule e
                           WHERE e.loan_id = l.id AND e.status <> 'paid') r
      WHERE l.user_id = $1
        AND l.status = 'active'
        AND l.interest_type = 'floating'
        AND r.remaining > 0
        AND o.outstanding > 0
        AND l.interest_rate + $2 / 100.0 > 0
      ORDER BY o.outstanding DESC`,
    [userId, bps],
  );
  const loans = rows.map((r) => {
    const oldEmi = num(r.old_emi);
    const newEmi = num(r.new_emi);
    const remaining = Number(r.remaining);
    return {
      loanId: Number(r.id),
      lender: r.lender,
      loanType: r.loan_type,
      rate: num(r.interest_rate),
      newRate: num(r.new_rate),
      outstanding: num(r.outstanding),
      remaining,
      oldEmi,
      newEmi,
      emiChange: newEmi - oldEmi,
      lifetimeChange: (newEmi - oldEmi) * remaining,
    };
  });
  return {
    bps,
    loans,
    totalMonthlyChange: loans.reduce((s, l) => s + l.emiChange, 0),
    totalLifetimeChange: loans.reduce((s, l) => s + l.lifetimeChange, 0),
  };
}

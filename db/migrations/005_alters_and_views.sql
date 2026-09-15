-- =============================================================================
-- 005_alters_and_views.sql — Phase 2: schema evolution + reporting views.
--
-- Two jobs:
--   (a) ALTER the Phase 1 schema to support liquidity analysis, which the
--       dashboard's emergency-fund metric needs.
--   (b) Create the reporting views the analytics screens read from, so the
--       aggregation logic lives in the database rather than being re-derived
--       in TypeScript on every request.
-- =============================================================================

-- =========================================================== PART A — ALTER

-- An asset's liquidity is not derivable from its type alone in every case
-- (a sovereign gold bond is liquid; inherited jewellery in a locker is not),
-- so it becomes a first-class column the user can override.
DO $$ BEGIN
  CREATE TYPE asset_liquidity AS ENUM ('liquid', 'illiquid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS liquidity asset_liquidity NOT NULL DEFAULT 'illiquid';

-- Backfill the existing rows from their asset type. Cash, deposits and market
-- instruments can be realised within days; property, retirement accounts
-- (EPF/PPF are locked until maturity) and vehicles cannot.
UPDATE assets
   SET liquidity = 'liquid'
 WHERE asset_type IN ('cash', 'fd', 'equity', 'mutual_fund', 'gold');

-- Guard a value the app now depends on: an asset cannot be revalued into the
-- future. (Added as a named constraint via ALTER so it can be dropped and
-- re-added independently of the CREATE TABLE.)
ALTER TABLE assets
  DROP CONSTRAINT IF EXISTS assets_valuation_not_in_future;
ALTER TABLE assets
  ADD CONSTRAINT assets_valuation_not_in_future
  CHECK (valuation_date <= CURRENT_DATE + INTERVAL '1 day');

-- The Phase 1 net worth trigger fired on ANY status change to an installment.
-- Phase 2 introduces the pending -> overdue transition, which does not change
-- outstanding principal, so recomputing net worth for it is pure waste.
-- Narrow the trigger to transitions that actually involve a payment.
DROP TRIGGER IF EXISTS trg_emi_net_worth ON emi_schedule;
CREATE TRIGGER trg_emi_net_worth
  AFTER UPDATE OF status ON emi_schedule
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
        AND (OLD.status = 'paid' OR NEW.status = 'paid'))
  EXECUTE FUNCTION trg_fn_refresh_net_worth();

-- Flips pending installments whose due date has passed. Called on dashboard
-- load; cheap because idx_emi_due_pending is a partial index over exactly
-- these rows.
CREATE OR REPLACE FUNCTION fn_mark_overdue_emis(p_user_id BIGINT)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE emi_schedule e
     SET status = 'overdue'
    FROM loans l
   WHERE e.loan_id = l.id
     AND l.user_id = p_user_id
     AND l.status  = 'active'
     AND e.status  = 'pending'
     AND e.due_date < CURRENT_DATE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- =========================================================== PART B — VIEWS

-- --------------------------------------------------- v_net_worth_summary
-- Live net worth, computed from source rather than read from the snapshot
-- table. The snapshot is the historical record; this is the ground truth the
-- snapshot is reconciled against.
--
-- Two derived tables instead of two correlated subqueries per column: each
-- side aggregates once, then the users table is LEFT JOINed to both, so a user
-- with no assets or no loans still appears (with zeros).
CREATE OR REPLACE VIEW v_net_worth_summary AS
SELECT u.id                                        AS user_id,
       u.name,
       COALESCE(a.total_assets, 0)                 AS total_assets,
       COALESCE(a.liquid_assets, 0)                AS liquid_assets,
       COALESCE(a.asset_count, 0)                  AS asset_count,
       COALESCE(l.total_liabilities, 0)            AS total_liabilities,
       COALESCE(l.active_loan_count, 0)            AS active_loan_count,
       COALESCE(l.monthly_emi_burden, 0)           AS monthly_emi_burden,
       COALESCE(a.total_assets, 0) - COALESCE(l.total_liabilities, 0) AS net_worth,
       -- Debt-to-asset ratio: the standard solvency read. NULLIF guards the
       -- divide-by-zero for a user with no assets yet.
       ROUND(100.0 * COALESCE(l.total_liabilities, 0)
             / NULLIF(COALESCE(a.total_assets, 0), 0), 2) AS debt_to_asset_pct
  FROM users u
  LEFT JOIN (
        SELECT user_id,
               SUM(current_value)                                    AS total_assets,
               SUM(current_value) FILTER (WHERE liquidity = 'liquid') AS liquid_assets,
               COUNT(*)                                              AS asset_count
          FROM assets
         GROUP BY user_id
  ) a ON a.user_id = u.id
  LEFT JOIN (
        SELECT l2.user_id,
               SUM(fn_loan_outstanding(l2.id)) AS total_liabilities,
               COUNT(*)                        AS active_loan_count,
               -- Each loan's EMI is the amount on its first installment.
               SUM((SELECT e.emi_amount
                      FROM emi_schedule e
                     WHERE e.loan_id = l2.id AND e.installment_no = 1)) AS monthly_emi_burden
          FROM loans l2
         WHERE l2.status = 'active'
         GROUP BY l2.user_id
  ) l ON l.user_id = u.id;

COMMENT ON VIEW v_net_worth_summary IS
  'Live per-user solvency position. net_worth_snapshots is the historical series.';

-- --------------------------------------------------- v_upcoming_emi_dues
-- The reminder / calendar feed. Bucketing into urgency bands in SQL means the
-- UI only has to colour by a string it is handed.
CREATE OR REPLACE VIEW v_upcoming_emi_dues AS
SELECT l.user_id,
       l.id                          AS loan_id,
       l.lender,
       l.loan_type,
       e.id                          AS installment_id,
       e.installment_no,
       e.due_date,
       e.emi_amount,
       e.principal_component,
       e.interest_component,
       e.closing_balance,
       e.status,
       (e.due_date - CURRENT_DATE)   AS days_until_due,
       CASE
         WHEN e.due_date <  CURRENT_DATE                      THEN 'overdue'
         WHEN e.due_date <= CURRENT_DATE + INTERVAL '7 days'  THEN 'due_this_week'
         WHEN e.due_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'due_this_month'
         ELSE 'upcoming'
       END                           AS urgency
  FROM emi_schedule e
  JOIN loans l ON l.id = e.loan_id
 WHERE e.status <> 'paid'
   AND l.status = 'active';
-- Reads through idx_emi_due_pending, the partial index over exactly the
-- non-paid installments this view selects.

-- --------------------------------------------------- v_asset_allocation
-- Portfolio mix, with each class's share of the whole computed by a window
-- function over the post-GROUP BY result.
CREATE OR REPLACE VIEW v_asset_allocation AS
SELECT user_id,
       asset_type,
       COUNT(*)                AS holdings,
       SUM(purchase_value)     AS invested,
       SUM(current_value)      AS current_value,
       SUM(current_value) - SUM(purchase_value) AS unrealised_gain,
       ROUND(100.0 * (SUM(current_value) - SUM(purchase_value))
             / NULLIF(SUM(purchase_value), 0), 2)              AS gain_pct,
       ROUND(100.0 * SUM(current_value)
             / NULLIF(SUM(SUM(current_value)) OVER (PARTITION BY user_id), 0), 2)
                               AS allocation_pct
  FROM assets
 GROUP BY user_id, asset_type;
-- SUM(SUM(...)) OVER (PARTITION BY user_id) is each user's grand total,
-- evaluated after aggregation — the reason this needs a window function and
-- not a plain subquery.

-- ------------------------------------------------ v_loan_payoff_progress
-- One row per loan, collapsing its entire amortisation table.
CREATE OR REPLACE VIEW v_loan_payoff_progress AS
SELECT l.user_id,
       l.id      AS loan_id,
       l.lender,
       l.loan_type,
       l.interest_type,
       l.principal,
       l.interest_rate,
       l.tenure_months,
       l.start_date,
       l.status,
       COUNT(e.id)                                        AS total_installments,
       COUNT(e.id) FILTER (WHERE e.status = 'paid')       AS paid_installments,
       COUNT(e.id) FILTER (WHERE e.status = 'overdue')    AS overdue_installments,
       SUM(e.principal_component) FILTER (WHERE e.status = 'paid') AS principal_repaid,
       SUM(e.interest_component)  FILTER (WHERE e.status = 'paid') AS interest_paid,
       SUM(e.interest_component)                          AS total_interest,
       fn_loan_outstanding(l.id)                          AS outstanding,
       MIN(e.due_date) FILTER (WHERE e.status <> 'paid')  AS next_due_date,
       MAX(e.due_date)                                    AS final_due_date,
       ROUND(100.0 * COUNT(e.id) FILTER (WHERE e.status = 'paid')
             / NULLIF(COUNT(e.id), 0), 2)                 AS tenure_progress_pct,
       ROUND(100.0 * (l.principal - fn_loan_outstanding(l.id))
             / NULLIF(l.principal, 0), 2)                 AS principal_progress_pct
  FROM loans l
  LEFT JOIN emi_schedule e ON e.loan_id = l.id
 GROUP BY l.id;
-- Tenure progress and principal progress diverge sharply early in a loan
-- (month 12 of 240 is 5% of the tenure but under 2% of the principal) — the
-- payoff screen shows both so that gap is visible.

-- ---------------------------------------------------- v_monthly_cashflow
-- Income vs expense per calendar month, plus a running net position computed
-- with a window function over the ordered months.
CREATE OR REPLACE VIEW v_monthly_cashflow AS
SELECT user_id,
       month,
       income,
       expense,
       income - expense AS net,
       SUM(income - expense) OVER (PARTITION BY user_id ORDER BY month) AS cumulative_net
  FROM (
        SELECT user_id,
               date_trunc('month', txn_date)::date               AS month,
               COALESCE(SUM(amount) FILTER (WHERE txn_type = 'income'),  0) AS income,
               COALESCE(SUM(amount) FILTER (WHERE txn_type = 'expense'), 0) AS expense
          FROM transactions
         GROUP BY user_id, date_trunc('month', txn_date)
  ) m;

-- ------------------------------------------------------ v_category_spend
-- Expense breakdown per user per month, with each category's share of that
-- month's spending.
CREATE OR REPLACE VIEW v_category_spend AS
SELECT user_id,
       date_trunc('month', txn_date)::date AS month,
       category,
       COUNT(*)    AS txn_count,
       SUM(amount) AS total,
       ROUND(100.0 * SUM(amount)
             / NULLIF(SUM(SUM(amount)) OVER (PARTITION BY user_id, date_trunc('month', txn_date)), 0), 2)
                   AS share_pct
  FROM transactions
 WHERE txn_type = 'expense'
 GROUP BY user_id, date_trunc('month', txn_date), category;

-- -------------------------------------------------- v_recurring_expenses
-- Which categories are genuine monthly commitments rather than one-off spends.
--
-- This is what HAVING is for: the filter is on an AGGREGATE over each group
-- (appeared in at least 3 distinct months), which WHERE cannot express because
-- WHERE is evaluated before rows are grouped.
CREATE OR REPLACE VIEW v_recurring_expenses AS
SELECT user_id,
       category,
       COUNT(DISTINCT date_trunc('month', txn_date))  AS months_seen,
       COUNT(*)                                       AS txn_count,
       ROUND(AVG(amount), 2)                          AS avg_amount,
       MIN(amount)                                    AS min_amount,
       MAX(amount)                                    AS max_amount,
       SUM(amount)                                    AS total_spent,
       -- Monthly run rate: total spend spread over the months it appeared in.
       ROUND(SUM(amount) / NULLIF(COUNT(DISTINCT date_trunc('month', txn_date)), 0), 2)
                                                      AS monthly_run_rate
  FROM transactions
 WHERE txn_type = 'expense'
   AND txn_date >= CURRENT_DATE - INTERVAL '12 months'
 GROUP BY user_id, category
HAVING COUNT(DISTINCT date_trunc('month', txn_date)) >= 3;

COMMENT ON VIEW v_recurring_expenses IS
  'Categories appearing in 3+ distinct months of the last year — the household''s
   standing commitments. Filtered with HAVING because the predicate is on an
   aggregate, not on individual rows.';

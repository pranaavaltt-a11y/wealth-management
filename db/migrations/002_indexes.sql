-- =============================================================================
-- 002_indexes.sql — indexes, each justified by a concrete query pattern.
-- Every index below exists because a screen or report runs that exact shape.
-- =============================================================================

-- Login: SELECT ... FROM users WHERE email = $1
-- Already served by the UNIQUE constraint on users.email — no extra index.

-- Advisor dashboard: list the clients belonging to one advisor.
--   SELECT ... FROM users WHERE advisor_id = $1
CREATE INDEX IF NOT EXISTS idx_users_advisor ON users (advisor_id) WHERE advisor_id IS NOT NULL;

-- Asset list & allocation chart, always scoped to the logged-in user:
--   SELECT ... FROM assets WHERE user_id = $1 ORDER BY asset_type
-- Composite so the GROUP BY asset_type rollup can be served from the index.
CREATE INDEX IF NOT EXISTS idx_assets_user_type ON assets (user_id, asset_type);

-- Loan list, and "active loans only" filter used by net worth + credit score:
--   SELECT ... FROM loans WHERE user_id = $1 AND status = 'active'
CREATE INDEX IF NOT EXISTS idx_loans_user_status ON loans (user_id, status);

-- Amortisation table for one loan, in installment order:
--   SELECT ... FROM emi_schedule WHERE loan_id = $1 ORDER BY installment_no
-- (The UNIQUE (loan_id, installment_no) constraint already indexes this.)

-- "Upcoming EMI dues" view — the hottest query in the app. Scans pending rows
-- across ALL of a user's loans ordered by date:
--   SELECT ... FROM emi_schedule WHERE status = 'pending' AND due_date <= $1
--                                ORDER BY due_date
-- Partial index: paid installments (the vast majority over time) are excluded,
-- which keeps the index small and the reminder query fast as history grows.
CREATE INDEX IF NOT EXISTS idx_emi_due_pending
  ON emi_schedule (due_date) WHERE status IN ('pending', 'overdue');

-- Transaction ledger + monthly/FY reports, newest first:
--   SELECT ... FROM transactions WHERE user_id = $1 AND txn_date BETWEEN $2 AND $3
--                                ORDER BY txn_date DESC
CREATE INDEX IF NOT EXISTS idx_txn_user_date ON transactions (user_id, txn_date DESC);

-- Category-wise spend view: GROUP BY category for one user within a period.
CREATE INDEX IF NOT EXISTS idx_txn_user_type_category
  ON transactions (user_id, txn_type, category);

-- CSV import dedupe (Phase 3): before inserting, probe for an existing hash.
--   SELECT 1 FROM transactions WHERE user_id = $1 AND import_hash = ANY($2)
CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_import_hash
  ON transactions (user_id, import_hash) WHERE import_hash IS NOT NULL;

-- Net worth trend chart: one user's snapshots in date order.
--   SELECT ... FROM net_worth_snapshots WHERE user_id = $1 ORDER BY snapshot_date
-- Served by UNIQUE (user_id, snapshot_date).

-- Recommendation engine (Phase 4) filters the catalogue by type + eligibility:
--   SELECT ... FROM loan_products WHERE is_active AND loan_type = $1 AND min_credit_score <= $2
CREATE INDEX IF NOT EXISTS idx_loan_products_match
  ON loan_products (loan_type, min_credit_score) WHERE is_active;

-- Latest credit score per user: ORDER BY computed_date DESC LIMIT 1.
CREATE INDEX IF NOT EXISTS idx_credit_score_user_date
  ON credit_score_history (user_id, computed_date DESC);

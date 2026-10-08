-- =============================================================================
-- 008_smart_features.sql — Phase 4 (smart features) and Phase 5 (reporting).
--
--   A. Integrity guard: regenerating a schedule must never erase payments
--   B. Prepayment: simulate (FUNCTION) and apply (PROCEDURE)
--   C. Derived credit score + statement-level triggers with transition tables
--   D. Loan product recommendation engine (weighted, rule-based SQL)
--   E. What-if net worth projection
--   F. Financial-year (April–March) reporting with an expression index
--   G. EMI reminders / notifications
--
-- Custom SQLSTATEs in the WWnnn form carry an HTTP status the API layer maps
-- directly: WW404 not found, WW409 conflict, WW422 invalid input.
-- =============================================================================

-- ==================================================== A. INTEGRITY GUARD

-- The Phase 1 generator DELETEs every installment before rebuilding, which is
-- correct for a brand-new loan but would silently erase payment history if a
-- loan with paid installments were edited. Repayment history is the one thing
-- this system must never lose, so the guard lives in the database rather than
-- trusting every caller to check first.
CREATE OR REPLACE FUNCTION fn_generate_emi_schedule(p_loan_id BIGINT)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_loan         loans%ROWTYPE;
  v_emi          NUMERIC(15,2);
  v_monthly_rate NUMERIC;
  v_balance      NUMERIC(15,2);
  v_interest     NUMERIC(15,2);
  v_principal    NUMERIC(15,2);
  i              INTEGER;
BEGIN
  SELECT * INTO v_loan FROM loans WHERE id = p_loan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Loan % does not exist', p_loan_id USING ERRCODE = 'WW404';
  END IF;

  IF EXISTS (SELECT 1 FROM emi_schedule WHERE loan_id = p_loan_id AND status = 'paid') THEN
    RAISE EXCEPTION 'This loan already has paid installments, so its terms are locked.'
      USING ERRCODE = 'WW409',
            HINT = 'Record a prepayment instead of editing the principal, rate or tenure.';
  END IF;

  DELETE FROM emi_schedule WHERE loan_id = p_loan_id;

  v_emi          := fn_calculate_emi(v_loan.principal, v_loan.interest_rate, v_loan.tenure_months);
  v_monthly_rate := v_loan.interest_rate / 12 / 100;
  v_balance      := v_loan.principal;

  FOR i IN 1..v_loan.tenure_months LOOP
    v_interest := ROUND(v_balance * v_monthly_rate, 2);
    IF i = v_loan.tenure_months THEN
      v_principal := v_balance;
    ELSE
      v_principal := LEAST(v_emi - v_interest, v_balance);
    END IF;
    v_balance := v_balance - v_principal;

    INSERT INTO emi_schedule (loan_id, installment_no, due_date, emi_amount,
                              principal_component, interest_component, closing_balance, status)
    VALUES (p_loan_id, i, (v_loan.start_date + (i || ' months')::INTERVAL)::DATE,
            CASE WHEN i = v_loan.tenure_months THEN v_principal + v_interest ELSE v_emi END,
            v_principal, v_interest, v_balance, 'pending');
  END LOOP;

  RETURN v_loan.tenure_months;
END;
$$;

-- ========================================================= B. PREPAYMENT

-- Every applied prepayment is recorded. Outstanding principal between a
-- prepayment and the next paid installment depends on this table.
CREATE TABLE IF NOT EXISTS loan_prepayments (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loan_id           BIGINT        NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  amount            NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  after_installment INTEGER       NOT NULL CHECK (after_installment >= 0),
  mode              TEXT          NOT NULL CHECK (mode IN ('reduce_tenure', 'reduce_emi')),
  balance_before    NUMERIC(15,2) NOT NULL CHECK (balance_before > 0),
  balance_after     NUMERIC(15,2) NOT NULL CHECK (balance_after >= 0),
  interest_saved    NUMERIC(15,2) NOT NULL DEFAULT 0,
  prepaid_on        DATE          NOT NULL DEFAULT CURRENT_DATE,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  -- The arithmetic is checked by the database, not just by the procedure.
  CONSTRAINT prepay_balance_consistent CHECK (balance_after = balance_before - amount)
);
CREATE INDEX IF NOT EXISTS idx_prepay_loan ON loan_prepayments (loan_id, after_installment);

-- Outstanding = closing balance of the last paid installment, minus any
-- prepayment made since. Once the next installment is paid, its closing
-- balance already reflects the prepayment, so the subtraction applies only to
-- prepayments recorded after that same installment.
CREATE OR REPLACE FUNCTION fn_loan_outstanding(p_loan_id BIGINT)
RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  WITH last_paid AS (
    SELECT e.installment_no, e.closing_balance
      FROM emi_schedule e
     WHERE e.loan_id = p_loan_id AND e.status = 'paid'
     ORDER BY e.installment_no DESC
     LIMIT 1
  )
  SELECT GREATEST(0,
           COALESCE((SELECT closing_balance FROM last_paid),
                    (SELECT l.principal FROM loans l WHERE l.id = p_loan_id))
         - COALESCE((SELECT SUM(p.amount)
                       FROM loan_prepayments p
                      WHERE p.loan_id = p_loan_id
                        AND p.after_installment = COALESCE((SELECT installment_no FROM last_paid), 0)), 0));
$$;

-- One installment row. A named composite type lets the procedure hold a whole
-- simulated schedule in an array between computing it and writing it.
DO $$ BEGIN
  CREATE TYPE emi_row AS (
    installment_no      INTEGER,
    due_date            DATE,
    emi_amount          NUMERIC(15,2),
    principal_component NUMERIC(15,2),
    interest_component  NUMERIC(15,2),
    closing_balance     NUMERIC(15,2)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------- fn_simulate_prepayment
-- Read-only: returns the schedule that WOULD result from paying p_amount now.
--
--   reduce_tenure  keep the EMI, finish sooner. Solves for n in the annuity
--                  formula:  n = -ln(1 - B·r / E) / ln(1 + r)
--   reduce_emi     keep the remaining tenure, lower the EMI.
--
-- Reducing tenure almost always saves more interest; the simulator shows both
-- so the user can see that trade-off rather than being told about it.
CREATE OR REPLACE FUNCTION fn_simulate_prepayment(
  p_loan_id BIGINT,
  p_amount  NUMERIC,
  p_mode    TEXT DEFAULT 'reduce_tenure'
) RETURNS SETOF emi_row
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_loan      loans%ROWTYPE;
  v_k         INTEGER;
  v_remaining INTEGER;
  v_balance   NUMERIC(15,2);
  v_r         NUMERIC;
  v_emi       NUMERIC(15,2);
  v_n         INTEGER;
  v_interest  NUMERIC(15,2);
  v_principal NUMERIC(15,2);
  v_row       emi_row;
  i           INTEGER;
BEGIN
  SELECT * INTO v_loan FROM loans WHERE id = p_loan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Loan % does not exist', p_loan_id USING ERRCODE = 'WW404';
  END IF;
  IF v_loan.status <> 'active' THEN
    RAISE EXCEPTION 'Only an active loan can be prepaid.' USING ERRCODE = 'WW409';
  END IF;
  IF p_mode NOT IN ('reduce_tenure', 'reduce_emi') THEN
    RAISE EXCEPTION 'Mode must be reduce_tenure or reduce_emi.' USING ERRCODE = 'WW422';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Prepayment amount must be positive.' USING ERRCODE = 'WW422';
  END IF;

  SELECT COALESCE(MAX(e.installment_no), 0) INTO v_k
    FROM emi_schedule e WHERE e.loan_id = p_loan_id AND e.status = 'paid';
  SELECT COUNT(*) INTO v_remaining
    FROM emi_schedule e WHERE e.loan_id = p_loan_id AND e.status <> 'paid';
  IF v_remaining = 0 THEN
    RAISE EXCEPTION 'This loan has no installments left to prepay.' USING ERRCODE = 'WW409';
  END IF;

  v_balance := fn_loan_outstanding(p_loan_id) - p_amount;
  IF v_balance < 0 THEN
    RAISE EXCEPTION 'Prepayment of % exceeds the outstanding principal of %.',
      p_amount, fn_loan_outstanding(p_loan_id) USING ERRCODE = 'WW422';
  END IF;
  IF v_balance = 0 THEN
    RETURN;  -- paid off in full: the new schedule is empty
  END IF;

  -- Current EMI = the next unpaid installment's, so an earlier reduce_emi
  -- prepayment is respected.
  SELECT e.emi_amount INTO v_emi
    FROM emi_schedule e
   WHERE e.loan_id = p_loan_id AND e.status <> 'paid'
   ORDER BY e.installment_no LIMIT 1;

  v_r := v_loan.interest_rate / 12 / 100;

  IF p_mode = 'reduce_emi' OR v_balance * v_r >= v_emi THEN
    v_n   := v_remaining;
    v_emi := fn_calculate_emi(v_balance, v_loan.interest_rate, v_n);
  ELSIF v_r = 0 THEN
    v_n := CEIL(v_balance / v_emi);
  ELSE
    v_n := CEIL(-LN(1 - v_balance * v_r / v_emi) / LN(1 + v_r));
  END IF;
  v_n := GREATEST(1, LEAST(v_n, v_remaining));

  FOR i IN 1..v_n LOOP
    v_interest := ROUND(v_balance * v_r, 2);
    IF i = v_n THEN
      v_principal := v_balance;
    ELSE
      v_principal := LEAST(v_emi - v_interest, v_balance);
    END IF;
    v_balance := v_balance - v_principal;

    v_row.installment_no      := v_k + i;
    v_row.due_date            := (v_loan.start_date + ((v_k + i) || ' months')::INTERVAL)::DATE;
    v_row.emi_amount          := CASE WHEN i = v_n THEN v_principal + v_interest ELSE v_emi END;
    v_row.principal_component := v_principal;
    v_row.interest_component  := v_interest;
    v_row.closing_balance     := v_balance;
    RETURN NEXT v_row;
  END LOOP;
END;
$$;

-- --------------------------------------------------- sp_apply_prepayment
-- A PROCEDURE (invoked with CALL), not a function: it exists to change state.
-- Runs as one atomic unit:
--   1. lock the loan row (FOR UPDATE) so a concurrent EMI payment or second
--      prepayment cannot interleave
--   2. debit the asset the money came from, if one is named
--   3. compute the new schedule while the old one is still in place
--   4. replace every unpaid installment with it
--   5. record the prepayment and a ledger entry; close the loan if cleared
-- Any failure rolls back all of it.
--
-- Why step 2 matters: a prepayment is a balance-sheet transfer, not a gain.
-- Paying ₹3,00,000 from savings lowers the liability AND the savings by the
-- same amount, so net worth must not move. Without the debit, net worth would
-- jump by the full ₹3,00,000 — which is exactly what an early version did.
CREATE OR REPLACE PROCEDURE sp_apply_prepayment(
  p_user_id       BIGINT,
  p_loan_id       BIGINT,
  p_amount        NUMERIC,
  p_mode          TEXT,
  p_from_asset_id BIGINT DEFAULT NULL,
  INOUT p_interest_saved NUMERIC DEFAULT NULL
)
LANGUAGE plpgsql AS $$
DECLARE
  v_lender       TEXT;
  v_k            INTEGER;
  v_before       NUMERIC(15,2);
  v_old_interest NUMERIC(15,2);
  v_new_interest NUMERIC(15,2);
  v_rows         emi_row[];
  v_asset_name   TEXT;
  v_asset_value  NUMERIC(15,2);
BEGIN
  SELECT l.lender INTO v_lender
    FROM loans l
   WHERE l.id = p_loan_id AND l.user_id = p_user_id AND l.status = 'active'
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active loan % for this user.', p_loan_id USING ERRCODE = 'WW404';
  END IF;

  IF p_from_asset_id IS NOT NULL THEN
    SELECT a.name, a.current_value INTO v_asset_name, v_asset_value
      FROM assets a
     WHERE a.id = p_from_asset_id AND a.user_id = p_user_id
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Source asset % not found for this user.', p_from_asset_id USING ERRCODE = 'WW404';
    END IF;
    IF v_asset_value < p_amount THEN
      RAISE EXCEPTION '% holds %, which is less than the % prepayment.',
        v_asset_name, v_asset_value, p_amount USING ERRCODE = 'WW422';
    END IF;
    UPDATE assets
       SET current_value  = current_value - p_amount,
           valuation_date = GREATEST(valuation_date, CURRENT_DATE)
     WHERE id = p_from_asset_id;
  END IF;

  SELECT COALESCE(MAX(e.installment_no), 0) INTO v_k
    FROM emi_schedule e WHERE e.loan_id = p_loan_id AND e.status = 'paid';
  v_before := fn_loan_outstanding(p_loan_id);
  SELECT COALESCE(SUM(e.interest_component), 0) INTO v_old_interest
    FROM emi_schedule e WHERE e.loan_id = p_loan_id AND e.status <> 'paid';

  -- Step 2 must happen before step 3: the simulation reads the unpaid rows
  -- that are about to be deleted.
  SELECT array_agg(s ORDER BY s.installment_no) INTO v_rows
    FROM fn_simulate_prepayment(p_loan_id, p_amount, p_mode) s;
  SELECT COALESCE(SUM(r.interest_component), 0) INTO v_new_interest
    FROM unnest(v_rows) r;

  DELETE FROM emi_schedule WHERE loan_id = p_loan_id AND status <> 'paid';

  IF v_rows IS NOT NULL THEN
    INSERT INTO emi_schedule (loan_id, installment_no, due_date, emi_amount,
                              principal_component, interest_component, closing_balance, status)
    SELECT p_loan_id, r.installment_no, r.due_date, r.emi_amount,
           r.principal_component, r.interest_component, r.closing_balance, 'pending'
      FROM unnest(v_rows) r;
  END IF;

  p_interest_saved := v_old_interest - v_new_interest;

  INSERT INTO loan_prepayments (loan_id, amount, after_installment, mode,
                                balance_before, balance_after, interest_saved)
  VALUES (p_loan_id, p_amount, v_k, p_mode, v_before, v_before - p_amount, p_interest_saved);

  INSERT INTO transactions (user_id, txn_type, amount, txn_date, category,
                            description, source, related_loan_id, related_asset_id)
  VALUES (p_user_id, 'loan', p_amount, CURRENT_DATE, 'Loan Prepayment',
          'Prepayment — ' || v_lender
            || COALESCE(' (from ' || v_asset_name || ')', ''),
          'manual', p_loan_id, p_from_asset_id);

  IF v_before - p_amount = 0 THEN
    UPDATE loans SET status = 'closed' WHERE id = p_loan_id;
  END IF;
END;
$$;

-- The shared net worth trigger body now also resolves users for prepayments.
CREATE OR REPLACE FUNCTION trg_fn_refresh_net_worth()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_row     RECORD;
  v_user_id BIGINT;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF TG_TABLE_NAME IN ('emi_schedule', 'loan_prepayments') THEN
    SELECT l.user_id INTO v_user_id FROM loans l WHERE l.id = v_row.loan_id;
  ELSE
    v_user_id := v_row.user_id;
  END IF;
  IF v_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = v_user_id) THEN
    PERFORM fn_refresh_net_worth(v_user_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_prepay_net_worth ON loan_prepayments;
CREATE TRIGGER trg_prepay_net_worth
  AFTER INSERT ON loan_prepayments
  FOR EACH ROW EXECUTE FUNCTION trg_fn_refresh_net_worth();

-- ============================================================ G (part 1)
-- Notifications are created by the credit score function below, so the table
-- has to exist first.
CREATE TABLE IF NOT EXISTS notifications (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT        NOT NULL CHECK (kind IN ('emi_due', 'emi_overdue', 'score_change')),
  title          TEXT        NOT NULL,
  body           TEXT        NOT NULL,
  installment_id BIGINT      REFERENCES emi_schedule(id) ON DELETE CASCADE,
  due_date       DATE,
  is_read        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One reminder of each kind per installment, ever: running the generator on
-- every page load must not spam the user. Partial, because score_change rows
-- have no installment.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_once
  ON notifications (user_id, kind, installment_id) WHERE installment_id IS NOT NULL;
-- The bell badge: "how many unread does this user have?"
CREATE INDEX IF NOT EXISTS idx_notif_unread
  ON notifications (user_id, created_at DESC) WHERE NOT is_read;

-- ======================================================= C. CREDIT SCORE

-- A SIMULATED score on the 300–900 range Indian bureaus use, derived only from
-- this database. It is never presented as a CIBIL / Experian / Equifax score.
--
--   35%  payment history   on-time share of due installments, minus a
--                          penalty per installment currently overdue
--   25%  debt-to-assets    outstanding loans against total assets
--   15%  loan mix          one or two active loans is ideal; many is a risk
--   15%  history length    months since the first loan, saturating at 7 years
--   10%  track record      loans closed cleanly versus defaulted
--
-- p_as_of lets the seed backfill a historical series by evaluating only the
-- data visible on that date.
CREATE OR REPLACE FUNCTION fn_compute_credit_score(
  p_user_id BIGINT,
  p_as_of   DATE DEFAULT CURRENT_DATE
) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_due INTEGER; v_on_time INTEGER; v_late INTEGER; v_overdue INTEGER;
  v_active INTEGER; v_closed INTEGER; v_defaulted INTEGER; v_first DATE;
  v_assets NUMERIC; v_liab NUMERIC; v_months NUMERIC; v_dta NUMERIC;
  f_payment NUMERIC; f_debt NUMERIC; f_mix NUMERIC; f_age NUMERIC; f_track NUMERIC;
  v_score INTEGER; v_prev INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RETURN NULL;
  END IF;

  -- Installments that had fallen due strictly before the as-of date.
  -- A 3-day grace period counts as on time, as most lenders allow.
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE e.paid_date <= p_as_of AND e.paid_date <= e.due_date + 3),
         COUNT(*) FILTER (WHERE e.paid_date <= p_as_of AND e.paid_date >  e.due_date + 3),
         COUNT(*) FILTER (WHERE e.paid_date IS NULL OR e.paid_date > p_as_of)
    INTO v_due, v_on_time, v_late, v_overdue
    FROM emi_schedule e
    JOIN loans l ON l.id = e.loan_id
   WHERE l.user_id = p_user_id
     AND l.start_date <= p_as_of
     AND e.due_date < p_as_of
     AND e.status <> 'waived';

  SELECT COUNT(*) FILTER (WHERE l.status = 'active'),
         COUNT(*) FILTER (WHERE l.status = 'closed'),
         COUNT(*) FILTER (WHERE l.status = 'defaulted'),
         MIN(l.start_date)
    INTO v_active, v_closed, v_defaulted, v_first
    FROM loans l
   WHERE l.user_id = p_user_id AND l.start_date <= p_as_of;

  SELECT n.total_assets, n.total_liabilities INTO v_assets, v_liab
    FROM net_worth_snapshots n
   WHERE n.user_id = p_user_id AND n.snapshot_date <= p_as_of
   ORDER BY n.snapshot_date DESC LIMIT 1;
  IF NOT FOUND THEN
    SELECT s.total_assets, s.total_liabilities INTO v_assets, v_liab
      FROM v_net_worth_summary s WHERE s.user_id = p_user_id;
  END IF;

  -- Payment history. No history at all is "unknown", not "bad".
  IF v_due = 0 THEN
    f_payment := 0.6;
  ELSE
    f_payment := (v_on_time + 0.5 * v_late)::NUMERIC / v_due - LEAST(0.6, 0.15 * v_overdue);
  END IF;
  f_payment := GREATEST(0, LEAST(1, f_payment));

  -- Debt against assets.
  IF COALESCE(v_assets, 0) = 0 THEN
    f_debt := CASE WHEN COALESCE(v_liab, 0) = 0 THEN 0.7 ELSE 0 END;
    v_dta  := NULL;
  ELSE
    v_dta  := v_liab / v_assets;
    f_debt := GREATEST(0, 1 - v_dta);
  END IF;

  f_mix := CASE
             WHEN v_active = 0     THEN 0.5
             WHEN v_active <= 2    THEN 1.0
             WHEN v_active = 3     THEN 0.8
             WHEN v_active = 4     THEN 0.6
             ELSE 0.3
           END;

  v_months := CASE WHEN v_first IS NULL THEN 0
                   ELSE (p_as_of - v_first) / 30.44 END;
  f_age := LEAST(1, v_months / 84);

  f_track := CASE WHEN v_closed + v_defaulted = 0 THEN 0.5
                  ELSE v_closed::NUMERIC / (v_closed + v_defaulted) END;

  v_score := 300 + ROUND(600 * (0.35 * f_payment + 0.25 * f_debt + 0.15 * f_mix
                                + 0.15 * f_age   + 0.10 * f_track));

  SELECT c.score INTO v_prev
    FROM credit_score_history c
   WHERE c.user_id = p_user_id AND c.computed_date < p_as_of
   ORDER BY c.computed_date DESC LIMIT 1;

  INSERT INTO credit_score_history (user_id, score, computed_date, factors_json)
  VALUES (p_user_id, v_score, p_as_of, jsonb_build_object(
    'model', 'wealthwise-derived-v1',
    'disclaimer', 'Derived from WealthWise repayment records only. Not a credit bureau score.',
    'factors', jsonb_build_object(
      'payment_history', jsonb_build_object('weight', 0.35, 'value', ROUND(f_payment, 3)),
      'debt_to_assets',  jsonb_build_object('weight', 0.25, 'value', ROUND(f_debt, 3)),
      'loan_mix',        jsonb_build_object('weight', 0.15, 'value', ROUND(f_mix, 3)),
      'history_length',  jsonb_build_object('weight', 0.15, 'value', ROUND(f_age, 3)),
      'track_record',    jsonb_build_object('weight', 0.10, 'value', ROUND(f_track, 3))
    ),
    'inputs', jsonb_build_object(
      'installments_due', v_due, 'on_time', v_on_time, 'late', v_late, 'overdue', v_overdue,
      'active_loans', v_active, 'closed_loans', v_closed, 'defaulted_loans', v_defaulted,
      'history_months', ROUND(v_months),
      'debt_to_asset_pct', ROUND(100 * v_dta, 1)
    )
  ))
  ON CONFLICT (user_id, computed_date) DO UPDATE
    SET score = EXCLUDED.score, factors_json = EXCLUDED.factors_json, created_at = now();

  -- A meaningful move in today's score becomes a notification.
  IF p_as_of = CURRENT_DATE AND v_prev IS NOT NULL AND ABS(v_score - v_prev) >= 15 THEN
    INSERT INTO notifications (user_id, kind, title, body)
    VALUES (p_user_id, 'score_change',
            CASE WHEN v_score > v_prev THEN 'Your WealthWise score rose' ELSE 'Your WealthWise score fell' END,
            format('Now %s, from %s. This is a derived score, not a bureau score.', v_score, v_prev));
  END IF;

  RETURN v_score;
END;
$$;

-- ---------------------------------------- statement-level score triggers
-- Recomputing per ROW would rescore a user once for every installment touched
-- — a bulk "mark 60 installments paid" would compute the same score 60 times.
-- These are FOR EACH STATEMENT triggers with TRANSITION TABLES: the trigger
-- sees every changed row at once (old_rows / new_rows), works out the
-- DISTINCT set of affected users, and scores each one exactly once.
CREATE OR REPLACE FUNCTION trg_fn_credit_score_emi()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT l.user_id
      FROM new_rows n
      JOIN old_rows o ON o.id = n.id
      JOIN loans l    ON l.id = n.loan_id
     WHERE o.status IS DISTINCT FROM n.status
       AND (n.status IN ('paid', 'overdue') OR o.status IN ('paid', 'overdue'))
  LOOP
    PERFORM fn_compute_credit_score(r.user_id);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_emi_credit_score ON emi_schedule;
CREATE TRIGGER trg_emi_credit_score
  AFTER UPDATE ON emi_schedule
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_credit_score_emi();

-- One body, three triggers: each names its transition table changed_rows.
CREATE OR REPLACE FUNCTION trg_fn_credit_score_loans()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT c.user_id FROM changed_rows c LOOP
    PERFORM fn_compute_credit_score(r.user_id);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_loans_score_ins ON loans;
CREATE TRIGGER trg_loans_score_ins AFTER INSERT ON loans
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_credit_score_loans();

DROP TRIGGER IF EXISTS trg_loans_score_upd ON loans;
CREATE TRIGGER trg_loans_score_upd AFTER UPDATE ON loans
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_credit_score_loans();

DROP TRIGGER IF EXISTS trg_loans_score_del ON loans;
CREATE TRIGGER trg_loans_score_del AFTER DELETE ON loans
  REFERENCING OLD TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_credit_score_loans();

-- ================================================ D. RECOMMENDATION ENGINE

-- Rule-based, no ML: the user's profile is CROSS JOINed against the product
-- catalogue, every product is priced for this borrower, and a weighted score
-- ranks them.
--
--   Estimated rate  interpolated inside the lender's band: a score at the
--                   lender's minimum gets the top of the band, 900 the bottom.
--   FOIR            Fixed Obligation to Income Ratio — all EMIs including
--                   the new one, over monthly income. Indian lenders typically
--                   cap this near 50%.
--   Match score     40 rate + 25 score headroom + 15 fee + 20 affordability.
--
-- Ineligible products are still returned, ranked last, with the reasons —
-- "why not" is as useful to the user as "which one".
CREATE OR REPLACE FUNCTION fn_recommend_loan_products(
  p_user_id       BIGINT,
  p_loan_type     loan_type,
  p_amount        NUMERIC,
  p_tenure_months INTEGER
) RETURNS TABLE (
  product_id     BIGINT,
  lender         TEXT,
  product_name   TEXT,
  eligible       BOOLEAN,
  reasons        TEXT[],
  estimated_rate NUMERIC,
  tenure_months  INTEGER,
  estimated_emi  NUMERIC,
  processing_fee NUMERIC,
  total_cost     NUMERIC,
  foir_pct       NUMERIC,
  match_score    NUMERIC
)
LANGUAGE sql STABLE AS $$
  WITH profile AS (
    SELECT
      COALESCE((SELECT c.score FROM credit_score_history c
                 WHERE c.user_id = p_user_id
                 ORDER BY c.computed_date DESC LIMIT 1), 650)            AS score,
      COALESCE((SELECT AVG(m.income) FROM v_monthly_cashflow m
                 WHERE m.user_id = p_user_id AND m.income > 0
                   AND m.month >= date_trunc('month', CURRENT_DATE) - INTERVAL '6 months'), 0)
                                                                         AS monthly_income,
      COALESCE((SELECT s.monthly_emi_burden FROM v_net_worth_summary s
                 WHERE s.user_id = p_user_id), 0)                        AS existing_emi
  ),
  priced AS (
    SELECT p.id, p.lender, p.product_name, p.min_credit_score, p.max_tenure_months,
           p.min_amount, p.max_amount, p.processing_fee_pct,
           pr.score, pr.monthly_income, pr.existing_emi,
           ROUND(p.interest_rate_min + (p.interest_rate_max - p.interest_rate_min)
                 * (1 - LEAST(1, GREATEST(0, (pr.score - p.min_credit_score)::NUMERIC
                                              / NULLIF(900 - p.min_credit_score, 0)))), 2) AS est_rate,
           LEAST(p_tenure_months, p.max_tenure_months)                   AS eff_tenure
      FROM loan_products p
     CROSS JOIN profile pr
     WHERE p.is_active AND p.loan_type = p_loan_type
  ),
  costed AS (
    SELECT q.*,
           fn_calculate_emi(p_amount, q.est_rate, q.eff_tenure)          AS emi,
           ROUND(p_amount * q.processing_fee_pct / 100, 2)                AS fee
      FROM priced q
  )
  SELECT k.id,
         k.lender,
         k.product_name,
         (k.score >= k.min_credit_score
          AND p_amount BETWEEN k.min_amount AND k.max_amount
          AND k.monthly_income > 0
          AND (k.existing_emi + k.emi) / k.monthly_income <= 0.5)        AS eligible,
         ARRAY_REMOVE(ARRAY[
           CASE WHEN k.score < k.min_credit_score
                THEN format('Score %s is below this lender''s minimum of %s', k.score, k.min_credit_score) END,
           CASE WHEN p_amount < k.min_amount
                THEN format('Below the minimum loan of ₹%s', k.min_amount) END,
           CASE WHEN p_amount > k.max_amount
                THEN format('Above the maximum loan of ₹%s', k.max_amount) END,
           CASE WHEN p_tenure_months > k.max_tenure_months
                THEN format('Tenure capped at %s months', k.max_tenure_months) END,
           CASE WHEN k.monthly_income = 0
                THEN 'No income recorded, so affordability cannot be assessed'
                WHEN (k.existing_emi + k.emi) / k.monthly_income > 0.5
                THEN format('EMIs would take %s%% of income (lenders cap near 50%%)',
                            ROUND(100 * (k.existing_emi + k.emi) / k.monthly_income)) END
         ], NULL)                                                         AS reasons,
         k.est_rate,
         k.eff_tenure,
         k.emi,
         k.fee,
         ROUND(k.emi * k.eff_tenure + k.fee, 2)                           AS total_cost,
         ROUND(100 * (k.existing_emi + k.emi) / NULLIF(k.monthly_income, 0), 1) AS foir_pct,
         ROUND(
             40 * GREATEST(0, LEAST(1, 1 - (k.est_rate - 7) / 20))
           + 25 * GREATEST(0, LEAST(1, (k.score - k.min_credit_score)::NUMERIC / 150))
           + 15 * GREATEST(0, 1 - k.processing_fee_pct / 3)
           + 20 * CASE WHEN k.monthly_income = 0 THEN 0
                       ELSE GREATEST(0, 1 - ((k.existing_emi + k.emi) / k.monthly_income) / 0.5) END
         , 1)                                                             AS match_score
    FROM costed k
   ORDER BY eligible DESC, match_score DESC;
$$;

-- ================================================ E. WHAT-IF PROJECTION

-- Month-by-month net worth for the next p_months, under two scenarios:
--   baseline   every active loan follows its schedule
--   scenario   p_close_loan_id is paid off today from assets, and the EMI it
--              no longer demands is saved each month instead
-- Assets compound at p_asset_growth_pct a year in both. With zero growth the
-- end-of-horizon difference equals the interest that loan would have charged.
CREATE OR REPLACE FUNCTION fn_project_net_worth(
  p_user_id          BIGINT,
  p_months           INTEGER DEFAULT 60,
  p_close_loan_id    BIGINT  DEFAULT NULL,
  p_asset_growth_pct NUMERIC DEFAULT 8
) RETURNS TABLE (
  month_offset         INTEGER,
  month                DATE,
  assets               NUMERIC,
  liabilities          NUMERIC,
  net_worth            NUMERIC,
  scenario_assets      NUMERIC,
  scenario_liabilities NUMERIC,
  scenario_net_worth   NUMERIC
)
LANGUAGE sql STABLE AS $$
  WITH params AS (
    SELECT p_asset_growth_pct / 1200.0 AS g,
           COALESCE((SELECT s.total_assets FROM v_net_worth_summary s
                      WHERE s.user_id = p_user_id), 0) AS a0
  ),
  loans_now AS (
    SELECT l.id,
           (SELECT COALESCE(MAX(e.installment_no), 0) FROM emi_schedule e
             WHERE e.loan_id = l.id AND e.status = 'paid')                 AS k,
           fn_loan_outstanding(l.id)                                       AS outstanding
      FROM loans l
     WHERE l.user_id = p_user_id AND l.status = 'active'
  ),
  closing AS (
    SELECT c.k, c.outstanding
      FROM loans_now c WHERE c.id = p_close_loan_id
  ),
  months AS (SELECT generate_series(0, p_months) AS t),
  liab AS (
    -- Outstanding on each loan t months from now = the closing balance of the
    -- installment t places past the last one paid (0 once the loan has ended).
    SELECT m.t,
           SUM(b.bal)                                                       AS total,
           COALESCE(SUM(b.bal) FILTER (WHERE ln.id IS DISTINCT FROM p_close_loan_id), 0) AS scenario
      FROM months m
     CROSS JOIN loans_now ln
     CROSS JOIN LATERAL (
       SELECT CASE WHEN m.t = 0 THEN ln.outstanding
                   ELSE COALESCE((SELECT e.closing_balance FROM emi_schedule e
                                   WHERE e.loan_id = ln.id
                                     AND e.installment_no = ln.k + m.t), 0)
              END AS bal
     ) b
     GROUP BY m.t
  ),
  grown AS (
    SELECT m.t,
           pa.a0 * POWER(1 + pa.g, m.t)                                     AS base_assets,
           CASE WHEN c.outstanding IS NULL THEN pa.a0 * POWER(1 + pa.g, m.t)
                ELSE (pa.a0 - c.outstanding) * POWER(1 + pa.g, m.t)
                     -- Each EMI no longer owed is saved in the month it would
                     -- have been paid, then compounds to month t. Summed from
                     -- the actual schedule rather than assuming every EMI is
                     -- equal: after a reduce-tenure prepayment the final
                     -- installment is much smaller, and a closed-form
                     -- "EMI × months" overstated the benefit by that gap.
                     + COALESCE((
                         SELECT SUM(e.emi_amount * POWER(1 + pa.g, m.t - (e.installment_no - c.k)))
                           FROM emi_schedule e
                          WHERE e.loan_id = p_close_loan_id
                            AND e.installment_no >  c.k
                            AND e.installment_no <= c.k + m.t), 0)
           END                                                              AS scen_assets
      FROM months m
     CROSS JOIN params pa
      LEFT JOIN closing c ON TRUE
  )
  SELECT gr.t,
         (date_trunc('month', CURRENT_DATE) + (gr.t || ' months')::INTERVAL)::DATE,
         ROUND(gr.base_assets, 2),
         ROUND(COALESCE(li.total, 0), 2),
         ROUND(gr.base_assets - COALESCE(li.total, 0), 2),
         ROUND(gr.scen_assets, 2),
         ROUND(COALESCE(li.scenario, 0), 2),
         ROUND(gr.scen_assets - COALESCE(li.scenario, 0), 2)
    FROM grown gr
    LEFT JOIN liab li ON li.t = gr.t
   ORDER BY gr.t;
$$;

-- =================================================== F. FINANCIAL YEAR

-- India's financial year runs 1 April – 31 March. 15 Mar 2026 is in FY 2025-26;
-- 1 Apr 2026 starts FY 2026-27.
--
-- Declared IMMUTABLE (it depends only on its argument), which is exactly what
-- makes it legal to index on.
CREATE OR REPLACE FUNCTION fn_fy_start_year(d DATE)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN EXTRACT(MONTH FROM d) >= 4
              THEN EXTRACT(YEAR FROM d)::INTEGER
              ELSE EXTRACT(YEAR FROM d)::INTEGER - 1 END;
$$;

CREATE OR REPLACE FUNCTION fn_fy_label(p_start_year INTEGER)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT 'FY ' || p_start_year || '-' || LPAD(((p_start_year + 1) % 100)::TEXT, 2, '0');
$$;

-- EXPRESSION INDEX. The FY report filters on fn_fy_start_year(txn_date), not
-- on txn_date itself, so an ordinary index on txn_date cannot serve it. This
-- indexes the computed value directly.
CREATE INDEX IF NOT EXISTS idx_txn_user_fy
  ON transactions (user_id, fn_fy_start_year(txn_date));

CREATE OR REPLACE VIEW v_fy_summary AS
SELECT t.user_id,
       fn_fy_start_year(t.txn_date)                                   AS fy_start_year,
       fn_fy_label(fn_fy_start_year(t.txn_date))                      AS fy_label,
       COALESCE(SUM(t.amount) FILTER (WHERE t.txn_type = 'income'),  0) AS income,
       COALESCE(SUM(t.amount) FILTER (WHERE t.txn_type = 'expense'), 0) AS expense,
       COALESCE(SUM(t.amount) FILTER (WHERE t.txn_type = 'loan'),    0) AS loan_outflow,
       COALESCE(SUM(t.amount) FILTER (WHERE t.txn_type = 'asset'),   0) AS asset_purchases,
       COUNT(*)                                                       AS txn_count,
       ROUND(100 * (COALESCE(SUM(t.amount) FILTER (WHERE t.txn_type = 'income'), 0)
                  - COALESCE(SUM(t.amount) FILTER (WHERE t.txn_type = 'expense'), 0))
             / NULLIF(SUM(t.amount) FILTER (WHERE t.txn_type = 'income'), 0), 1) AS savings_rate_pct
  FROM transactions t
 GROUP BY t.user_id, fn_fy_start_year(t.txn_date);

CREATE OR REPLACE VIEW v_fy_category_spend AS
SELECT t.user_id,
       fn_fy_start_year(t.txn_date) AS fy_start_year,
       t.category,
       COUNT(*)                     AS txn_count,
       SUM(t.amount)                AS total,
       ROUND(100 * SUM(t.amount)
             / NULLIF(SUM(SUM(t.amount)) OVER (PARTITION BY t.user_id, fn_fy_start_year(t.txn_date)), 0), 2)
                                    AS share_pct
  FROM transactions t
 WHERE t.txn_type = 'expense'
 GROUP BY t.user_id, fn_fy_start_year(t.txn_date), t.category;

-- Repayments by financial year, from the amortisation table itself — accurate
-- even for EMIs that were never mirrored into the ledger.
CREATE OR REPLACE VIEW v_fy_loan_summary AS
SELECT l.user_id,
       fn_fy_start_year(e.paid_date) AS fy_start_year,
       l.id                          AS loan_id,
       l.lender,
       l.loan_type,
       COUNT(*)                      AS emis_paid,
       SUM(e.emi_amount)             AS total_paid,
       SUM(e.principal_component)    AS principal_repaid,
       SUM(e.interest_component)     AS interest_paid
  FROM emi_schedule e
  JOIN loans l ON l.id = e.loan_id
 WHERE e.status = 'paid'
 GROUP BY l.user_id, fn_fy_start_year(e.paid_date), l.id, l.lender, l.loan_type;

-- Indicative deduction headroom under the old tax regime. Indicative only: the
-- 80C limit is shared with EPF, PPF, ELSS and insurance, and none of this
-- applies under the new regime.
--   Sec 24(b)  home loan interest,      capped at ₹2,00,000
--   Sec 80C    home loan principal,     capped at ₹1,50,000 (shared)
--   Sec 80E    education loan interest, uncapped
CREATE OR REPLACE VIEW v_fy_tax_hints AS
SELECT s.user_id,
       s.fy_start_year,
       fn_fy_label(s.fy_start_year) AS fy_label,
       LEAST(200000, COALESCE(SUM(s.interest_paid)    FILTER (WHERE s.loan_type = 'home'), 0))      AS sec24b_home_interest,
       LEAST(150000, COALESCE(SUM(s.principal_repaid) FILTER (WHERE s.loan_type = 'home'), 0))      AS sec80c_home_principal,
       COALESCE(SUM(s.interest_paid) FILTER (WHERE s.loan_type = 'education'), 0)                   AS sec80e_education_interest
  FROM v_fy_loan_summary s
 GROUP BY s.user_id, s.fy_start_year;

-- ============================================================= G (part 2)

-- Creates reminders for installments due within p_days_ahead days, plus
-- overdue ones. Idempotent: the partial unique index means a second run
-- inserts nothing. Reminders for installments since paid are marked read.
--
-- In-app only. Email or SMS delivery would need a provider (SES, Twilio,
-- MSG91) and is deliberately out of scope.
CREATE OR REPLACE FUNCTION fn_generate_emi_reminders(
  p_user_id    BIGINT,
  p_days_ahead INTEGER DEFAULT 7
) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE notifications n
     SET is_read = TRUE
    FROM emi_schedule e
   WHERE n.installment_id = e.id
     AND e.status = 'paid'
     AND n.user_id = p_user_id
     AND NOT n.is_read;

  INSERT INTO notifications (user_id, kind, title, body, installment_id, due_date)
  SELECT d.user_id,
         CASE WHEN d.urgency = 'overdue' THEN 'emi_overdue' ELSE 'emi_due' END,
         CASE WHEN d.urgency = 'overdue' THEN 'EMI overdue — ' ELSE 'EMI due soon — ' END || d.lender,
         format('Installment #%s of ₹%s %s %s.',
                d.installment_no,
                to_char(d.emi_amount, 'FM99,99,99,990.00'),
                CASE WHEN d.urgency = 'overdue' THEN 'was due on' ELSE 'is due on' END,
                to_char(d.due_date, 'DD Mon YYYY')),
         d.installment_id,
         d.due_date
    FROM v_upcoming_emi_dues d
   WHERE d.user_id = p_user_id
     AND d.days_until_due <= p_days_ahead
  ON CONFLICT (user_id, kind, installment_id) WHERE installment_id IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

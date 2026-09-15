-- =============================================================================
-- 003_emi_functions.sql — EMI amortisation as Postgres functions.
--
-- Why in the database and not in TypeScript?
--   * The schedule is written in the same transaction that creates the loan, so
--     a loan can never exist without its schedule.
--   * Prepayment recalculation (Phase 4) reuses the identical maths, so there
--     is exactly one definition of "what the EMI is".
-- =============================================================================

-- --------------------------------------------------------- fn_calculate_emi
-- Standard reducing-balance (amortised) EMI:
--
--        P * r * (1 + r)^n
--   E = ---------------------      r = annual_rate / 12 / 100,  n = tenure
--         (1 + r)^n  -  1
--
-- Zero-interest loans degenerate to a simple P/n split (the formula divides by
-- zero at r = 0), so that case is handled separately.
CREATE OR REPLACE FUNCTION fn_calculate_emi(
  p_principal     NUMERIC,
  p_annual_rate   NUMERIC,
  p_tenure_months INTEGER
) RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_monthly_rate NUMERIC;
  v_growth       NUMERIC;   -- (1 + r)^n
BEGIN
  IF p_principal <= 0 OR p_tenure_months <= 0 THEN
    RAISE EXCEPTION 'fn_calculate_emi: principal and tenure must be positive (got %, %)',
      p_principal, p_tenure_months;
  END IF;

  IF p_annual_rate = 0 THEN
    RETURN ROUND(p_principal / p_tenure_months, 2);
  END IF;

  v_monthly_rate := p_annual_rate / 12 / 100;
  v_growth       := POWER(1 + v_monthly_rate, p_tenure_months);

  RETURN ROUND(p_principal * v_monthly_rate * v_growth / (v_growth - 1), 2);
END;
$$;

-- --------------------------------------------- fn_generate_emi_schedule
-- Materialises the full amortisation table for a loan into emi_schedule.
-- Deletes any existing rows first, so it is safe to re-run after an edit.
--
-- Per installment, on the reducing balance:
--   interest  = balance * r          (rounded to paise)
--   principal = EMI - interest
--   balance   = balance - principal
--
-- The final installment absorbs all accumulated rounding drift: its principal
-- component is set to whatever balance remains, so closing_balance lands on
-- exactly 0.00 rather than a few paise either side.
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
    RAISE EXCEPTION 'fn_generate_emi_schedule: loan % does not exist', p_loan_id;
  END IF;

  DELETE FROM emi_schedule WHERE loan_id = p_loan_id;

  v_emi          := fn_calculate_emi(v_loan.principal, v_loan.interest_rate, v_loan.tenure_months);
  v_monthly_rate := v_loan.interest_rate / 12 / 100;
  v_balance      := v_loan.principal;

  FOR i IN 1..v_loan.tenure_months LOOP
    v_interest := ROUND(v_balance * v_monthly_rate, 2);

    IF i = v_loan.tenure_months THEN
      v_principal := v_balance;                 -- absorb rounding drift
    ELSE
      v_principal := LEAST(v_emi - v_interest, v_balance);
    END IF;

    v_balance := v_balance - v_principal;

    INSERT INTO emi_schedule (
      loan_id, installment_no, due_date, emi_amount,
      principal_component, interest_component, closing_balance, status
    ) VALUES (
      p_loan_id,
      i,
      -- Due on the same day-of-month as the loan start, i months later.
      (v_loan.start_date + (i || ' months')::INTERVAL)::DATE,
      CASE WHEN i = v_loan.tenure_months THEN v_principal + v_interest ELSE v_emi END,
      v_principal,
      v_interest,
      v_balance,
      'pending'
    );
  END LOOP;

  RETURN v_loan.tenure_months;
END;
$$;

-- ------------------------------------------------ fn_loan_outstanding
-- Outstanding principal = closing balance of the last PAID installment, or the
-- full principal if nothing has been paid yet. Used by the net worth trigger
-- and the payoff-progress screen.
CREATE OR REPLACE FUNCTION fn_loan_outstanding(p_loan_id BIGINT)
RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT e.closing_balance
       FROM emi_schedule e
      WHERE e.loan_id = p_loan_id AND e.status = 'paid'
      ORDER BY e.installment_no DESC
      LIMIT 1),
    (SELECT l.principal FROM loans l WHERE l.id = p_loan_id)
  );
$$;

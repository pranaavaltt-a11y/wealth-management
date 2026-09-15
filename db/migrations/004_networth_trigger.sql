-- =============================================================================
-- 004_networth_trigger.sql — net worth snapshot maintenance.
--
-- (Phase 2 item #8, pulled forward: assets and loans created in Phase 1 are
--  meaningless without something computing net worth from them.)
--
-- Net worth = SUM(current asset values) - SUM(outstanding loan principal).
-- Rather than recomputing this on every page load, a trigger refreshes today's
-- snapshot whenever the underlying rows change, giving us both a cheap "current"
-- read and a free historical trend series.
-- =============================================================================

-- --------------------------------------------------- fn_refresh_net_worth
-- Recomputes and UPSERTs the snapshot for (user, today).
-- Idempotent: calling it twice in a row produces the same row.
CREATE OR REPLACE FUNCTION fn_refresh_net_worth(p_user_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_assets      NUMERIC(15,2);
  v_liabilities NUMERIC(15,2);
BEGIN
  SELECT COALESCE(SUM(a.current_value), 0)
    INTO v_assets
    FROM assets a
   WHERE a.user_id = p_user_id;

  -- Outstanding, not original principal: a loan half repaid is half a liability.
  -- fn_loan_outstanding() reads the amortisation table, so this stays correct
  -- as installments are marked paid.
  SELECT COALESCE(SUM(fn_loan_outstanding(l.id)), 0)
    INTO v_liabilities
    FROM loans l
   WHERE l.user_id = p_user_id
     AND l.status = 'active';

  INSERT INTO net_worth_snapshots (user_id, snapshot_date, total_assets, total_liabilities, net_worth)
  VALUES (p_user_id, CURRENT_DATE, v_assets, v_liabilities, v_assets - v_liabilities)
  ON CONFLICT (user_id, snapshot_date) DO UPDATE
    SET total_assets      = EXCLUDED.total_assets,
        total_liabilities = EXCLUDED.total_liabilities,
        net_worth         = EXCLUDED.net_worth,
        created_at        = now();
END;
$$;

-- ------------------------------------------------ trg_fn_refresh_net_worth
-- Shared trigger body for assets / loans / emi_schedule / transactions.
-- On DELETE the affected user comes from OLD; otherwise from NEW.
-- emi_schedule has no user_id of its own, so it is resolved through loans.
CREATE OR REPLACE FUNCTION trg_fn_refresh_net_worth()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_row     RECORD;
  v_user_id BIGINT;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  IF TG_TABLE_NAME = 'emi_schedule' THEN
    SELECT l.user_id INTO v_user_id FROM loans l WHERE l.id = v_row.loan_id;
  ELSE
    v_user_id := v_row.user_id;
  END IF;

  IF v_user_id IS NOT NULL THEN
    PERFORM fn_refresh_net_worth(v_user_id);
  END IF;

  RETURN NULL;   -- AFTER trigger: return value is ignored
END;
$$;

-- Statement-level would be cheaper for bulk loads, but row-level keeps the
-- "which user changed?" resolution simple and these tables see low write volume.
DROP TRIGGER IF EXISTS trg_assets_net_worth ON assets;
CREATE TRIGGER trg_assets_net_worth
  AFTER INSERT OR UPDATE OF current_value, user_id OR DELETE ON assets
  FOR EACH ROW EXECUTE FUNCTION trg_fn_refresh_net_worth();

DROP TRIGGER IF EXISTS trg_loans_net_worth ON loans;
CREATE TRIGGER trg_loans_net_worth
  AFTER INSERT OR UPDATE OF principal, status, user_id OR DELETE ON loans
  FOR EACH ROW EXECUTE FUNCTION trg_fn_refresh_net_worth();

-- Marking an installment paid reduces outstanding principal -> net worth moves.
DROP TRIGGER IF EXISTS trg_emi_net_worth ON emi_schedule;
CREATE TRIGGER trg_emi_net_worth
  AFTER UPDATE OF status ON emi_schedule
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trg_fn_refresh_net_worth();

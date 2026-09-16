-- =============================================================================
-- 007_fix_recategorize.sql
--
-- fn_recategorize_user() as written in 006 used
--   UPDATE transactions t ... FROM LATERAL (SELECT ... fn_categorize(..., t.description))
-- which Postgres rejects with "invalid reference to FROM-clause entry for
-- table t": the UPDATE target is not visible to a LATERAL item in its own
-- FROM clause.
--
-- A correlated subquery in the SET expression IS allowed to see the target
-- row, so that is what this uses. EXISTS in the WHERE clause keeps rows that
-- match no rule untouched, rather than overwriting them with NULL.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_recategorize_user(p_user_id BIGINT)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE transactions t
     SET category = (
           SELECT c.category
             FROM fn_categorize(p_user_id, COALESCE(t.description, '')) c
            LIMIT 1
         )
   WHERE t.user_id  = p_user_id
     AND t.source   = 'import'
     AND t.category = 'Uncategorized'
     AND EXISTS (
           SELECT 1 FROM fn_categorize(p_user_id, COALESCE(t.description, '')) c
         );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

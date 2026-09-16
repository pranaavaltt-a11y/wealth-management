-- =============================================================================
-- 006_import_and_search.sql — Phase 3: bank statement import, rule-based
-- categorisation, and full-text search over the ledger.
-- =============================================================================

-- ======================================================= PART A — CSV import

-- Links a transaction back to the MongoDB raw_imports document it came from.
--
-- This is a deliberate cross-database reference: the raw CSV rows live in Mongo
-- (they are ragged, bank-specific and not worth a relational shape), while the
-- normalised transaction lives here. Postgres cannot enforce a foreign key
-- across that boundary, so the column is a plain TEXT holding the Mongo
-- ObjectId, and the application is responsible for consistency. It is nullable
-- precisely because manual entries have no batch.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS import_batch_id TEXT;

COMMENT ON COLUMN transactions.import_batch_id IS
  'MongoDB raw_imports._id as a string. Cross-DB link, not FK-enforced.';

-- "Show me everything that came in from this upload" — the review screen after
-- an import, and the undo path if a user rejects a batch.
CREATE INDEX IF NOT EXISTS idx_txn_import_batch
  ON transactions (import_batch_id) WHERE import_batch_id IS NOT NULL;

-- ================================================ PART B — categorisation

-- Keyword rules live in the database, not in application code, so that a user
-- can add their own without a redeploy and so matching is a JOIN rather than a
-- loop in TypeScript.
--
-- user_id NULL  = system rule, applies to everyone
-- user_id SET   = that user's own rule, and it beats every system rule
CREATE TABLE IF NOT EXISTS categorization_rules (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT      REFERENCES users(id) ON DELETE CASCADE,
  keyword    TEXT        NOT NULL CHECK (length(trim(keyword)) >= 2),
  category   TEXT        NOT NULL CHECK (length(trim(category)) > 0),
  txn_type   txn_type    NOT NULL DEFAULT 'expense',
  -- Lower number wins. Specific merchants should outrank generic words:
  -- "SWIGGY" (10) must beat a catch-all like "UPI" (900).
  priority   INTEGER     NOT NULL DEFAULT 100 CHECK (priority > 0),
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A plain UNIQUE (user_id, keyword) would not work: NULL never equals NULL, so
-- it would allow unlimited duplicate system rules. Two partial unique indexes
-- enforce the intent on both halves.
CREATE UNIQUE INDEX IF NOT EXISTS idx_catrule_user_keyword
  ON categorization_rules (user_id, upper(keyword)) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_catrule_system_keyword
  ON categorization_rules (upper(keyword)) WHERE user_id IS NULL;

-- Matching order: user rules before system rules, then by priority.
CREATE INDEX IF NOT EXISTS idx_catrule_lookup
  ON categorization_rules (priority) WHERE is_active;

-- ------------------------------------------------------ fn_categorize
-- Resolves a bank narration to a category.
--
--   SELECT fn_categorize(2, 'UPI/SWIGGY BANGALORE/1234');  -> 'Dining'
--
-- The ORDER BY encodes precedence: a user's own rule first (user_id IS NOT NULL
-- sorts before NULL when we key on it explicitly), then priority, then the
-- longest keyword — so "BIG BAZAAR" beats a bare "BIG" when both match.
CREATE OR REPLACE FUNCTION fn_categorize(p_user_id BIGINT, p_description TEXT)
RETURNS TABLE (category TEXT, txn_type txn_type, matched_keyword TEXT)
LANGUAGE sql STABLE AS $$
  SELECT r.category, r.txn_type, r.keyword
    FROM categorization_rules r
   WHERE r.is_active
     AND (r.user_id = p_user_id OR r.user_id IS NULL)
     AND upper(p_description) LIKE '%' || upper(r.keyword) || '%'
   ORDER BY (r.user_id IS NOT NULL) DESC,   -- the user's own rule wins
            r.priority,                      -- then explicit precedence
            length(r.keyword) DESC           -- then the most specific match
   LIMIT 1;
$$;

-- --------------------------------------------- fn_recategorize_user
-- Re-applies the current rule set to a user's still-uncategorised imported
-- rows. Used after someone adds a rule and wants it applied retroactively.
CREATE OR REPLACE FUNCTION fn_recategorize_user(p_user_id BIGINT)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE transactions t
     SET category = c.category
    FROM LATERAL (SELECT * FROM fn_categorize(p_user_id, COALESCE(t.description, ''))) c
   WHERE t.user_id = p_user_id
     AND t.source  = 'import'
     AND t.category = 'Uncategorized'
     AND c.category IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------- system rule set
-- Seeded here rather than in the seed script: these are reference data the
-- application depends on, not demo data, so they belong with the schema.
INSERT INTO categorization_rules (user_id, keyword, category, txn_type, priority) VALUES
  -- Income (priority 10: these must beat any generic expense keyword)
  (NULL, 'SALARY',         'Salary',            'income',  10),
  (NULL, 'NEFT CR',        'Salary',            'income',  20),
  (NULL, 'INTEREST CREDIT','Interest Income',   'income',  10),
  (NULL, 'DIVIDEND',       'Dividend',          'income',  10),
  -- Food & groceries
  (NULL, 'BIGBASKET',      'Groceries',         'expense', 10),
  (NULL, 'BLINKIT',        'Groceries',         'expense', 10),
  (NULL, 'ZEPTO',          'Groceries',         'expense', 10),
  (NULL, 'DMART',          'Groceries',         'expense', 10),
  (NULL, 'RELIANCE FRESH', 'Groceries',         'expense', 10),
  (NULL, 'MORE SUPERMARK', 'Groceries',         'expense', 10),
  (NULL, 'SWIGGY',         'Dining',            'expense', 10),
  (NULL, 'ZOMATO',         'Dining',            'expense', 10),
  (NULL, 'RESTAURANT',     'Dining',            'expense', 50),
  (NULL, 'CAFE',           'Dining',            'expense', 50),
  -- Fuel & transport
  (NULL, 'INDIAN OIL',     'Fuel',              'expense', 10),
  (NULL, 'IOCL',           'Fuel',              'expense', 10),
  (NULL, 'BHARAT PETRO',   'Fuel',              'expense', 10),
  (NULL, 'HPCL',           'Fuel',              'expense', 10),
  (NULL, 'PETROL',         'Fuel',              'expense', 50),
  (NULL, 'UBER',           'Transport',         'expense', 10),
  (NULL, 'OLA ',           'Transport',         'expense', 10),
  (NULL, 'RAPIDO',         'Transport',         'expense', 10),
  (NULL, 'IRCTC',          'Travel',            'expense', 10),
  (NULL, 'MAKEMYTRIP',     'Travel',            'expense', 10),
  (NULL, 'INDIGO',         'Travel',            'expense', 10),
  -- Utilities & telecom
  (NULL, 'BESCOM',         'Utilities',         'expense', 10),
  (NULL, 'BSES',           'Utilities',         'expense', 10),
  (NULL, 'ELECTRICITY',    'Utilities',         'expense', 50),
  (NULL, 'GAS BILL',       'Utilities',         'expense', 50),
  (NULL, 'JIO',            'Mobile & Internet', 'expense', 10),
  (NULL, 'AIRTEL',         'Mobile & Internet', 'expense', 10),
  (NULL, 'VODAFONE',       'Mobile & Internet', 'expense', 10),
  (NULL, 'ACT FIBERNET',   'Mobile & Internet', 'expense', 10),
  -- Shopping & entertainment
  (NULL, 'AMAZON',         'Shopping',          'expense', 10),
  (NULL, 'FLIPKART',       'Shopping',          'expense', 10),
  (NULL, 'MYNTRA',         'Shopping',          'expense', 10),
  (NULL, 'AJIO',           'Shopping',          'expense', 10),
  (NULL, 'NETFLIX',        'Entertainment',     'expense', 10),
  (NULL, 'HOTSTAR',        'Entertainment',     'expense', 10),
  (NULL, 'SPOTIFY',        'Entertainment',     'expense', 10),
  (NULL, 'BOOKMYSHOW',     'Entertainment',     'expense', 10),
  -- Health, education, insurance
  (NULL, 'APOLLO',         'Healthcare',        'expense', 10),
  (NULL, 'PHARMEASY',      'Healthcare',        'expense', 10),
  (NULL, 'PHARMACY',       'Healthcare',        'expense', 50),
  (NULL, 'HOSPITAL',       'Healthcare',        'expense', 50),
  (NULL, 'SCHOOL FEE',     'Education',         'expense', 10),
  (NULL, 'TUITION',        'Education',         'expense', 10),
  (NULL, 'LIC ',           'Insurance',         'expense', 10),
  (NULL, 'PREMIUM',        'Insurance',         'expense', 60),
  -- Loans & investment
  (NULL, 'EMI',            'EMI Payment',       'expense', 30),
  (NULL, 'LOAN REPAY',     'EMI Payment',       'expense', 20),
  (NULL, 'SIP',            'Investment',        'expense', 20),
  (NULL, 'MUTUAL FUND',    'Investment',        'expense', 20),
  (NULL, 'ZERODHA',        'Investment',        'expense', 10),
  (NULL, 'GROWW',          'Investment',        'expense', 10),
  -- Generic fallbacks, deliberately last
  (NULL, 'ATM',            'Cash Withdrawal',   'expense', 800),
  (NULL, 'CASH WDL',       'Cash Withdrawal',   'expense', 800)
ON CONFLICT DO NOTHING;

-- =============================================== PART C — full-text search

-- Ledger search ("what did I spend at that pharmacy in June?") needs to match
-- word stems across description and category, not do a LIKE '%...%' scan.
--
-- A STORED generated column keeps the tsvector in sync automatically — no
-- trigger to forget, and no chance of the index drifting from the row.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(description, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(category, '')),   'B')
  ) STORED;

-- GIN is the right index for tsvector: slower to build than GiST but much
-- faster to query, and this column is written far less often than it is read.
CREATE INDEX IF NOT EXISTS idx_txn_search
  ON transactions USING GIN (search_vector);

COMMENT ON COLUMN transactions.search_vector IS
  'Generated tsvector; description weighted A, category B. Backed by a GIN index.';

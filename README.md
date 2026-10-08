# WealthWise

Personal net worth, loan and expense manager for the Indian market.

A hybrid-database full-stack application: **PostgreSQL** holds the transactional
relational core (users, assets, loans, EMI schedules, ledger, snapshots) and
**MongoDB** holds the schema-flexible material (uploaded documents, raw bank
statement imports, per-asset-type valuation history, cached news).

> **Simulated financial data.** WealthWise does not connect to any credit
> bureau, bank API, or payment gateway. The credit score is a
> metric *derived from this application's own repayment records* — it is not a
> CIBIL/Experian/Equifax score. "Mark EMI paid" records a payment in this
> ledger; it does not move money. See [Simulated vs. real](#simulated-vs-real).

---

## Status — complete

All five phases are built and tested: **67 automated tests, all passing.**

| Phase | Scope | State |
|---|---|---|
| **1 — Foundation** | Auth and roles, assets, loans with generated EMI schedules, manual ledger | ✅ |
| **2 — Analytics** | Net worth trend, allocation, payoff progress, upcoming dues, reporting views | ✅ |
| **3 — Import & documents** | Bank CSV import, receipt OCR, rule-based categorisation, document vault, full-text search | ✅ |
| **4 — Smart features** | Prepayment simulator, what-if projection, derived credit score, loan recommendations, news with rate impact | ✅ |
| **5 — Polish** | Financial-year reports, PDF net worth statement, EMI reminders | ✅ |

### Deliverables

| Document | What it is |
|---|---|
| [`docs/PROJECT_REPORT.md`](docs/PROJECT_REPORT.md) · [PDF](docs/PROJECT_REPORT.pdf) | The project report: problem, objectives, scope, requirements, ER diagram, schema, DB justification, implementation, queries, architecture, screenshots, testing, conclusion |
| [`docs/diagrams/er-conceptual.svg`](docs/diagrams/er-conceptual.svg) | Conceptual ER diagram, Chen notation |
| [`docs/diagrams/relational-schema.svg`](docs/diagrams/relational-schema.svg) | Relational schema, every column, crow's-foot FKs, generated from the live catalogue |
| [`docs/DATA_DICTIONARY.md`](docs/DATA_DICTIONARY.md) | Every table, column, constraint and index, generated from the live catalogue |
| [`docs/test-results.txt`](docs/test-results.txt) | Full output of the test suite |
| [`docs/screenshots/`](docs/screenshots/) | Every page, light and dark |

Regenerate the diagrams and data dictionary after a schema change with
`npm run docs:generate`.

---

## Setup

### Prerequisites

- Node.js 20+
- PostgreSQL 14+ (16 recommended)
- MongoDB 6+ *(optional — Mongo-backed features degrade gracefully without it)*

### 1. Install and configure

```bash
npm install
cp .env.example .env
```

Edit `.env`:

```ini
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/wealthwise
MONGODB_URI=mongodb://127.0.0.1:27017      # optional
MONGODB_DB=wealthwise
JWT_SECRET=<at least 32 random characters>  # openssl rand -base64 48
JWT_EXPIRES_IN=7d
```

No credential is ever hard-coded; every one is read from the environment.
`.env` is gitignored.

### 2. Create the database and run migrations

```bash
createdb wealthwise
npm run db:migrate          # applies db/migrations/*.sql in order
```

The runner records each applied file in `schema_migrations` and wraps every
migration in its own transaction, so a failing migration leaves no partial
schema behind.

```bash
npm run db:migrate -- --reset   # drop everything and re-apply from scratch
```

### 3. Seed demo data

```bash
npm run db:seed
```

Loads a realistic Indian household: a Whitefield flat, sovereign gold bonds,
EPF/PPF, index funds, an HDFC home loan and an SBI education loan, twelve
months of household spending, and a catalogue of thirteen real-world loan
products.

| Login | Password | Role |
|---|---|---|
| `priya@wealthwise.dev` | `password123` | Individual — full portfolio |
| `rahul@wealthwise.dev` | `password123` | Individual — smaller portfolio |
| `advisor@wealthwise.dev` | `password123` | Advisor for both |

`npm run db:reset` does a reset migrate + seed in one step.

### 4. Run

```bash
npm run dev          # http://localhost:3000
npm run build && npm start
npm run typecheck
npm test             # 28 unit + 39 database tests, against a separate wealthwise_test DB
npm run docs:generate   # re-derive the diagrams and data dictionary from the live schema
```

---

## Architecture

Each layer only talks to the one below it. No React component ever issues a
query; no route handler ever writes SQL inline.

```
  src/app/**/page.tsx          UI — server components fetch, client components interact
        │                      (components call /api/*, never the database)
        ▼
  src/app/api/**/route.ts      API layer — auth check, Zod validation, error mapping
        │
        ▼
  src/lib/services/*.ts        business logic — auth, valuation history
        │
        ▼
  src/lib/db/*.ts              data access — one module per entity, raw SQL only
        │
        ▼
  PostgreSQL  +  MongoDB       constraints, functions, triggers, views
```

```
src/
  app/
    (app)/                 authenticated shell — layout redirects if signed out
      dashboard/  assets/  loans/[id]/  transactions/
    api/
      auth/{signup,login,logout,me}/
      assets/[id]/  loans/[id]/schedule/  emi/[id]/pay/  transactions/[id]/  dashboard/
    login/  signup/  globals.css        design tokens
  components/              presentational only
  lib/
    auth/                  jwt.ts  password.ts  session.ts  cookie.ts
    db/                    postgres.ts  mongo.ts  users.ts  assets.ts  loans.ts
                           transactions.ts  networth.ts
    services/              auth-service.ts  valuation-service.ts
    validation/schemas.ts  Zod schemas mirroring the DB CHECK constraints
    api.ts  client.ts  format.ts  chart-colors.ts
db/migrations/             001_core_schema  002_indexes  003_emi_functions
                           004_networth_trigger
scripts/                   migrate.ts  seed.ts
```

**Why no ORM.** Postgres is reached through the `pg` driver with hand-written,
parameterised SQL. Every JOIN, GROUP BY, window function and stored-procedure
call is visible in `src/lib/db/*.ts` and explainable line by line — which is the
point of the exercise. Mongo uses the native `mongodb` driver for the same
reason.

---

## Database schema

**Conceptual (Chen notation)** — weak entities and identifying relationships
are drawn with double borders, derived attributes with dashed ellipses.

![ER diagram](docs/diagrams/er-conceptual.svg)

**Relational** — generated from the live database by `npm run docs:generate`.

![Relational schema](docs/diagrams/relational-schema.svg)

11 tables · 11 views · 14 functions · 1 procedure · 8 triggers · 35 indexes ·
41 CHECK constraints · 13 foreign keys · 9 enum types. Column-level detail is in
the [data dictionary](docs/DATA_DICTIONARY.md).

MongoDB holds four collections: `raw_imports`, `asset_valuation_history`,
`documents` and `news_articles`. Their document shapes and the reason each is a
document rather than a row are in §7 and §9.4 of the
[report](docs/PROJECT_REPORT.md#7-database-choice-and-justification).

### Design decisions worth defending

- **`NUMERIC(15,2)` for all money**, never `FLOAT`. Binary floating point cannot
  represent ₹0.10 exactly; over a 240-installment schedule the drift is real.
- **Amounts are always positive**; direction lives in `txn_type`. This makes
  `SUM(amount)` unambiguous and lets `CHECK (amount > 0)` do actual work.
- **Enum types** (`loan_type`, `emi_status`, …) rather than free-text columns, so
  a typo is a database error rather than a silently-missing dashboard row.
- **`emi_paid_date_consistency`** is a multi-column CHECK: a `paid` installment
  must have a `paid_date`, and an unpaid one must not.
- **`ON DELETE CASCADE`** from loans to their schedules; **`ON DELETE SET NULL`**
  from transactions to assets/loans, so deleting an asset never destroys the
  ledger history that referenced it.

---

## Advanced database features demonstrated

### 1. Transactions (atomicity)

| Operation | What must land together | Where |
|---|---|---|
| Create loan | `INSERT INTO loans` + `fn_generate_emi_schedule()` — a loan can never exist without its schedule | `src/lib/db/loans.ts` → `createLoan` |
| Edit loan terms | `UPDATE loans` + full schedule regeneration | `updateLoan` |
| Pay an EMI | flip installment → `paid`, write the ledger entry, auto-close the loan if it was the last one | `payInstallment` |
| Migrations | each `.sql` file inside `BEGIN`/`COMMIT` | `scripts/migrate.ts` |
| Seed | the entire seed is one transaction | `scripts/seed.ts` |

`withTransaction()` in `src/lib/db/postgres.ts` takes a single pooled client
through `BEGIN` → callback → `COMMIT`, rolling back on any throw.

### 2. Stored procedures / functions

| Function | Purpose |
|---|---|
| `fn_calculate_emi(principal, annual_rate, tenure)` | Reducing-balance EMI: `P·r·(1+r)ⁿ / ((1+r)ⁿ−1)`. `IMMUTABLE`. Handles the `r = 0` division-by-zero case. |
| `fn_generate_emi_schedule(loan_id)` | Materialises every installment with its principal/interest split and closing balance. The final installment absorbs accumulated rounding so the balance lands on exactly `0.00`. |
| `fn_loan_outstanding(loan_id)` | Closing balance of the last *paid* installment, else the full principal. `STABLE`. |
| `fn_refresh_net_worth(user_id)` | Recomputes and UPSERTs today's snapshot. Idempotent. |

Verified: ₹50,00,000 at 8.50% over 240 months → **₹43,391.16/month**, and
`SUM(principal_component)` over the generated schedule equals exactly
₹50,00,000.00.

### 3. Triggers

`trg_fn_refresh_net_worth()` is one trigger body shared by four tables. It
resolves the affected `user_id` from `NEW`/`OLD` (through `loans` for
`emi_schedule`, which has no `user_id` of its own) and calls
`fn_refresh_net_worth()`.

| Trigger | Fires on |
|---|---|
| `trg_assets_net_worth` | `INSERT` / `UPDATE OF current_value, user_id` / `DELETE` on `assets` |
| `trg_loans_net_worth` | `INSERT` / `UPDATE OF principal, status, user_id` / `DELETE` on `loans` |
| `trg_emi_net_worth` | `UPDATE OF status` on `emi_schedule`, guarded by `WHEN (OLD.status IS DISTINCT FROM NEW.status)` |

Narrowing to `UPDATE OF <columns>` plus the `WHEN` clause means editing an
asset's *name* does not trigger a net worth recomputation.

### 4. Window functions

| Query | Function | Why a subquery would not do |
|---|---|---|
| Asset allocation share | `SUM(SUM(current_value)) OVER ()` | The grand total is needed *after* `GROUP BY asset_type`, in the same pass. |
| Category spend share | `SUM(SUM(amount)) OVER ()` | Same shape, over expense categories. |
| Net worth trend | `LAG(net_worth) OVER (ORDER BY snapshot_date)` | Month-on-month delta computed in SQL, so the chart component stays dumb. |
| Advisor client list | `LEFT JOIN LATERAL (… ORDER BY snapshot_date DESC LIMIT 1)` | Picks each client's latest snapshot without one correlated subquery per column. |

### 5. Aggregate JOINs with `FILTER`

`listLoans()` collapses up to 480 `emi_schedule` rows per loan into one summary
row, computing four different aggregates in a single pass:

```sql
MAX(e.emi_amount)  FILTER (WHERE e.installment_no = 1)  AS emi_amount,
COUNT(e.id)        FILTER (WHERE e.status = 'paid')     AS paid_count,
MIN(e.due_date)    FILTER (WHERE e.status <> 'paid')    AS next_due_date
```

### 6. Views

Six reporting views in `005_alters_and_views.sql`. The aggregation lives in the
database, so one definition of "what allocation means" is shared by the
dashboard, the API and any future report.

| View | What it answers | Notable SQL |
|---|---|---|
| `v_net_worth_summary` | Live solvency per user | Two derived tables `LEFT JOIN`ed to `users`, so a user with no assets or loans still returns zeros rather than no row |
| `v_upcoming_emi_dues` | The reminder feed | `CASE` bucketing into overdue / this week / this month / upcoming; reads through the partial index |
| `v_asset_allocation` | Portfolio mix | `SUM(SUM(...)) OVER (PARTITION BY user_id)` for each class's share |
| `v_loan_payoff_progress` | One row per loan | Five `FILTER`ed aggregates collapsing up to 480 installment rows |
| `v_monthly_cashflow` | Income vs expense by month | `SUM(...) OVER (PARTITION BY user_id ORDER BY month)` running total |
| `v_category_spend` | Spend mix within a month | Share-of-month via a partitioned window |
| `v_recurring_expenses` | Standing monthly commitments | **`HAVING COUNT(DISTINCT month) >= 3`** |

`v_recurring_expenses` is where `HAVING` genuinely belongs: the filter is on an
aggregate over each group (*"appeared in at least three distinct months"*),
which `WHERE` cannot express because `WHERE` runs before rows are grouped.

### 7. Schema evolution (`ALTER`)

`005` alters the Phase 1 schema rather than rewriting it:

- `ALTER TABLE assets ADD COLUMN liquidity` (new `asset_liquidity` enum), then a
  backfill `UPDATE`, so the dashboard can compute emergency-fund coverage —
  how many months of typical spending the liquid assets would cover.
- `ALTER TABLE assets ADD CONSTRAINT assets_valuation_not_in_future`, added by
  name so it can be dropped and re-added independently of the `CREATE TABLE`.
- `DROP TRIGGER` / `CREATE TRIGGER` to narrow `trg_emi_net_worth`. Phase 2
  introduced the `pending -> overdue` transition, which does not change
  outstanding principal, so the trigger now fires only when a transition
  actually involves a payment.

### 8. Indexing

Every index in `002_indexes.sql` is annotated with the exact query that
justifies it. Two are worth calling out:

- **`idx_emi_due_pending`** — a *partial* index on `due_date`,
  `WHERE status IN ('pending','overdue')`. The upcoming-dues query is the
  hottest in the app, and over years the overwhelming majority of installments
  become `paid`. Excluding them keeps the index small and the reminder query
  fast as history grows.
- **`idx_txn_import_hash`** — a *partial unique* index on
  `(user_id, import_hash) WHERE import_hash IS NOT NULL`. This makes CSV import
  deduplication (Phase 3) a database guarantee rather than application
  etiquette, while leaving manually-entered rows (which have no hash) free to
  repeat.

Also: composite `(user_id, asset_type)` and `(user_id, txn_date DESC)` so the
per-user filter and the sort/rollup are served by one index.

### 8b. Rule-based categorisation (Phase 3)

Keyword rules live in `categorization_rules`, not in application code, so a
user can add one without a redeploy and matching is a query rather than a loop
in TypeScript.

`fn_categorize(user_id, description)` resolves a bank narration to a category.
Precedence is encoded in the ORDER BY: the user's own rule beats every system
rule, then explicit priority, then the longest keyword — so "BIG BAZAAR" beats
a bare "BIG", and "SWIGGY" (priority 10) beats a catch-all like "UPI" (900).

`user_id NULL` means a system rule shared by everyone. A plain
`UNIQUE (user_id, keyword)` would not work, because NULL never equals NULL and
duplicate system rules would slip through — so two *partial* unique indexes
enforce the intent on each half.

### 9. Full-text search

Ledger search matches word stems, not substrings: searching "pharmacy" finds
"Pharmacies", and `LIKE '%...%'` could never use an index anyway.

```sql
ALTER TABLE transactions ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(description, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(category, '')),   'B')
  ) STORED;
CREATE INDEX idx_txn_search ON transactions USING GIN (search_vector);
```

A **STORED generated column** keeps the vector in sync automatically — no
trigger to forget and no way for the index to drift from the row. Description
is weighted above category so a merchant name outranks an incidental category
match. Queries use `websearch_to_tsquery`, which accepts whatever a human types
(quoted phrases, `or`, `-`) without throwing a syntax error on a stray quote.

### 10. MongoDB

`asset_valuation_history` exists in Mongo, not Postgres, because the metadata
that matters differs completely per asset class:

```js
gold     → { grams: 42, purity: '22K', ratePerGram: 6180 }
property → { sqft: 1450, city: 'Bengaluru', circleRate: 5200 }
equity   → { units: 250, nav: 1684.40, folio: 'HDFC/2020/…' }
```

Modelling that relationally means either a wide sparse table or an EAV mess.
Aggregation pipelines over these documents arrive in Phases 3–4.

---

### 11. Phase 4–5 database features (migration 008)

| Feature | Object | What is worth noticing |
|---|---|---|
| Prepayment simulator | `fn_simulate_prepayment` | Solves for the new tenure, `n = −ln(1 − B·r/E) / ln(1+r)`; read-only |
| Prepayment, applied | **`sp_apply_prepayment` (PROCEDURE, `CALL`)** | Row locks with `FOR UPDATE`; debits the source asset so net worth does not move; `INOUT` result |
| Credit score | `fn_compute_credit_score` | Five weighted factors, 300–900, evaluable *as of* any past date; never presented as a bureau score |
| Score maintenance | **Statement-level triggers with transition tables** | `REFERENCING OLD TABLE … NEW TABLE`: paying 24 EMIs in one UPDATE rescores once, not 24 times |
| Recommendations | `fn_recommend_loan_products` | CROSS JOIN of profile × catalogue; rate interpolated in band by score; FOIR ≤ 50%; weighted rank |
| What-if projection | `fn_project_net_worth` | `generate_series` + `LATERAL`; at 0% growth the gain equals the remaining interest exactly |
| FY reporting | `fn_fy_start_year` + **expression index** | IMMUTABLE function, indexed; `EXPLAIN` confirms the FY filter uses it |
| Reminders | `notifications` + `fn_generate_emi_reminders` | Partial unique index makes generation idempotent |
| Integrity guard | `fn_generate_emi_schedule` | Refuses (`WW409`) to rebuild a schedule that has payments |

Custom SQLSTATEs of the form `WWnnn` carry an HTTP status, so a business-rule
violation raised in plpgsql reaches the user as a clear 404/409/422, not a 500.

## Course requirement coverage

Against the *DBMS Level 3 Project Requirements* brief:

| § | Requirement | Status |
|---|---|---|
| 3 | Two database paradigms — **Option 1: SQL + NoSQL** | ✅ PostgreSQL + MongoDB. (Option 2's vector database is an *alternative* to NoSQL, not an additional requirement.) |
| 4 | ER diagram converted to a relational schema; NoSQL data model documented | ✅ [Chen ER](docs/diagrams/er-conceptual.svg), [schema](docs/diagrams/relational-schema.svg), [report §5–§9](docs/PROJECT_REPORT.md) |
| 5 | DDL: `CREATE`, `ALTER`, `DROP`, keys, constraints, indexes, views | ✅ All present as of `005` |
| 6 | DML with `JOIN`, `GROUP BY`, `HAVING`, `ORDER BY`, aggregates, subqueries | ✅ All present |
| 7 | ≥ 4 advanced features | ✅ **9**: transactions, stored functions, a stored procedure, triggers (incl. statement-level with transition tables), views, indexing (partial, expression, GIN), window functions, full-text search, NoSQL aggregation |
| 8 | Vector / semantic search | ➖ Optional; deliberately not used — see below |
| 9–11 | Next.js interface, API layer, env config, auth with ≥ 2 roles | ✅ |
| 12–13 | Validation at the database level, no plaintext secrets | ✅ |
| 14 | Documentation | ✅ [Project report](docs/PROJECT_REPORT.md) covers all 14 listed items |
| 16 | Test cases | ✅ 67 automated tests — `npm test` |

**On the vector database.** §3 offers SQL + NoSQL *or* SQL + Vector; this project
takes the first. §8 recommends embeddings only for unstructured, text-heavy
data. WealthWise's data is overwhelmingly numeric and relational — amounts,
rates, dates, schedules — and its one text-heavy collection (cached news, Phase
4) is served by tag and category filters. Adding embeddings would be technology
for its own sake, which §18 explicitly warns against.

**One item is the team's to complete:** §2 and §15 require each member's
contribution to be visible in the commit history. Fill in §15 of the report and
make sure each member commits their own work under their own Git identity.

### MongoDB in this environment

Everything Mongo-backed — raw statement staging, the document vault, the
aggregation rollups — is written against the real driver, but could not be
executed here: the sandbox's egress proxy allows only npm, PyPI and crates, so
`fastdl.mongodb.org` and the Ubuntu MongoDB repositories are both unreachable.

The Postgres half of every feature is fully verified. The Mongo half needs a
local `mongod`:

```bash
docker run -d -p 27017:27017 --name wealthwise-mongo mongo:7
# MONGODB_URI=mongodb://127.0.0.1:27017 is already in .env.example
npm run dev
```

With Mongo absent the app degrades deliberately rather than breaking: imports
still complete (the preview reports `raw rows staged in Mongo: unavailable`),
valuation history is skipped, and the vault shows an explicit "MongoDB is not
reachable" panel rather than an empty list that would imply the user has no
documents.

---

## Charts

Three chart forms, each chosen for the job the data does:

| Chart | Form | Why |
|---|---|---|
| Net worth trend | Line + area, **single series** | Change over time. One series needs no legend — the title names it. |
| Assets vs liabilities | Line, two series | Its own panel rather than a third line on the chart above (see below). |
| Asset allocation | **Horizontal stacked bar** | Part-to-whole. A donut is unreadable past ~6 segments and this has up to ten, with long names like "Mutual Fund". |
| Income vs expense | Grouped bar | Magnitude comparison across two signed series. |

### The palette is validated, not eyeballed

Chart colours resolve from the same CSS variables the rest of the UI uses, so a
category is the same colour in the chart, the legend and the table. The
categorical order was **searched for and machine-verified** across both themes:

| Palette | Worst CVD ΔE | Worst normal-vision ΔE | Contrast |
|---|---|---|---|
| Categorical (7 hues), dark | 10.1 (deutan) | 18.3 | pass |
| Categorical (7 hues), light | 9.8 (deutan) | 18.3 | pass |
| Assets ↔ liabilities (dusk/rose) | 13.2 | 18.3 | pass |
| Income ↔ expense (sage/rose) | 9.9 | 20.1 | pass |

Three findings worth recording, because they changed the design:

1. **Seven hues is the ceiling at this saturation.** An eighth pushes the
   worst adjacent pair below the normal-vision floor — indistinguishable even
   with full colour vision. The palette is capped at seven; an eighth class
   folds into a reserved grey "Other" bucket rather than getting a generated
   hue.
2. **No trio passes**, which is why net worth is *not* overlaid on assets and
   liabilities. The chart is split into two stacked panels — small multiples —
   so no panel carries more than two series.
3. **The chroma floor is knowingly unmet.** These hues are deliberately
   desaturated; the calm, low-glare quality *is* the design. Because separation
   therefore sits around ΔE 10 rather than comfortably above it, **secondary
   encoding is mandatory**: every chart renders a legend, segments carry direct
   percentage labels, and the numbers are always available as a table. Colour
   is never the only channel.

Colour follows the entity, never its rank — a filter that changes which asset
classes are present never repaints the survivors.

---

## Security & validation

- **Passwords** hashed with bcrypt at 12 rounds. The plaintext is never stored,
  logged, or returned.
- **JWT** signed HS256 via `jose` (Edge-runtime compatible), delivered in an
  `httpOnly`, `sameSite=lax` cookie — unreadable from JavaScript, so XSS cannot
  exfiltrate the session. `secure` in production.
- **Login is not an account oracle.** "No such user" and "wrong password" return
  the same message, and the no-user branch still runs a bcrypt comparison so the
  two paths take comparable time.
- **Ownership is enforced in the `WHERE` clause**, not by a separate check —
  `DELETE FROM assets WHERE id = $1 AND user_id = $2`. There is no window
  between checking and acting.
- **Role separation.** An individual requesting `?userId=<someone else>` gets
  403. An advisor may read a client's data only if `advisorOwnsClient()`
  confirms that client's `advisor_id` points at them.
- **Validation happens twice, deliberately** — Zod at the API layer for a
  readable error, and `CHECK` / `NOT NULL` / `UNIQUE` at the database so nothing
  bad lands even via `psql`. Postgres error codes `23505` / `23514` / `23503`
  are mapped to 409 / 422 / 422 rather than leaking as 500s.
- **Every query is parameterised.** Optional filters use
  `($n IS NULL OR col = $n)` rather than string concatenation, so one prepared
  statement serves every filter combination and no injection surface exists.

---

## Design system

A calm, low-glare palette built for a screen someone looks at every day. Warm
paper in light mode, soft charcoal in dark, muted earth accents throughout —
nothing shouts, and red means "this needs attention" rather than alarm. No
default shadcn or Tailwind colours.

Tokens are CSS variables in `src/app/globals.css`, so light/dark is a single
`data-theme` swap on `<html>`, and `src/lib/chart-colors.ts` resolves the same
variables at runtime — a category is the same colour in the table, the chart
and the legend, in both themes.

| Role | Dark | Light |
|---|---|---|
| Background / raised | `#1e2225` / `#262b2e` | `#f7f4ee` / `#fbf9f5` |
| Text | `#e8e4dc` | `#3a3733` |
| Primary action — clay | `#e09b6b` | `#b0663a` |
| Positive / income — sage | `#a6c48a` | `#5f8449` |
| Negative / expense — rose | `#c96c6c` | `#8e3c3c` |
| Warning / due soon — amber | `#e8c878` | `#9c7620` |
| Informational — dusk | `#8fb2d0` | `#3f6a92` |
| Lilac | `#9885bb` | `#59447a` |
| Teal | `#5a9490` | `#2c635f` |

Inter for UI text, **JetBrains Mono with `tabular-nums` for every rupee
figure**, so columns of amounts line up and digits do not shift width as values
change. Rounded corners, hairline borders and very soft shadows — present
enough to separate surfaces, never heavy. Amounts use Indian digit grouping
(`₹92,00,000`, `₹1.06 Cr`), not thousands separators.

Theme choice persists to `localStorage`, and an inline script in
`src/app/layout.tsx` applies it before first paint so there is no flash of the
wrong theme.

---

## Simulated vs. real

| Feature | Reality | What WealthWise does |
|---|---|---|
| Credit score | Requires a licensed bureau (CIBIL/Experian/Equifax) | Computes a 300–900 score **from this app's own EMI payment history**, stored in `credit_score_history` with its factor breakdown. Labelled as derived everywhere it appears. |
| "Mark EMI paid" | Requires a payment gateway / bank mandate | Records the payment in this ledger. No money moves. |
| Bank statement import | Requires an account aggregator (RBI AA framework) | User uploads a CSV they downloaded themselves. |
| Asset valuations | Requires market data feeds | User-entered, with history retained. |
| Loan products | Requires lender partnerships | Static seeded catalogue of publicly-advertised rates. |
| News feed | A news provider | The RBI press-release RSS feed (official, free, no key), cached in MongoDB. Without Mongo or network access, clearly labelled *illustrative* sample articles are shown instead. Rate-impact figures are indicative, not advice. |

WealthWise is a personal-finance *record-keeping and analysis* tool. It gives no
financial advice and holds no real account credentials.

---

## Verified behaviour

The authoritative record is the automated suite (`npm test`, 67 tests,
[results](docs/test-results.txt)) and §13 of the
[report](docs/PROJECT_REPORT.md#13-testing). The notes below are the
phase-by-phase verification log kept while building.

### Phase 1

- EMI maths matches the standard reducing-balance formula; generated principal
  components sum to exactly the principal.
- Creating a loan generates its full schedule atomically.
- Paying an EMI writes the ledger entry, closes the loan on the last
  installment, refuses a double payment, and moves the net worth snapshot by
  the *principal* component (not the whole EMI).
- Cross-user access is refused: another user's loan reads as "not found", their
  EMI cannot be paid, and `?userId=` is rejected for individuals.
- Unauthenticated API calls return 401; unauthenticated pages redirect to
  `/login`.
- Out-of-range input (e.g. a 99% interest rate) is rejected at the API layer
  with a field-level error before reaching the database.
- With MongoDB unreachable, asset creation still succeeds; the failure is
  cached for a minute so requests do not stall on connection timeouts.

### Phase 2

- All six views return correct data; `v_loan_payoff_progress` shows tenure and
  principal progress diverging as expected (HDFC home loan: 35.8% of the tenure
  elapsed but only 18.6% of the principal repaid).
- `fn_mark_overdue_emis()` flips past-due installments: un-paying two seeded
  installments produced `markedOverdue: 2`, moved both into the `overdue`
  urgency band at −14 days, and surfaced the count in the payoff view.
- The dashboard reads entirely through the views; seven independent queries run
  concurrently on separate pool connections.
- Charts verified by screenshot in both themes. Three defects were found that
  way and fixed: two different asset groups rendering the same grey, an axis
  printing "₹2L" twice at different heights, and the net worth/liabilities
  lines being visually inseparable in light mode.

### Phase 3

- The CSV parser handles both a HDFC export (three junk preamble lines before
  the header, `Withdrawal Amt.`/`Deposit Amt.`, `dd/mm/yy`, commas *inside*
  quoted narrations, and Indian digit grouping like `"1,65,000.00"`) and an
  ICICI export (`Debit`/`Credit`, `yyyy-mm-dd`). Columns are matched by header
  name, not position.
- Invalid rows are rejected rather than silently coerced: `31/02/26` is caught
  (the `Date` constructor would roll it into March) and a row with no
  description is skipped, both with a reason shown to the user.
- Auto-categorisation assigned 9 of 10 rows correctly from the seeded system
  rules; the tenth was an invented merchant and correctly landed as
  `Uncategorized`. Adding a user rule for it and re-running
  `fn_recategorize_user` moved exactly 1 row.
- Rule precedence verified: with a personal `AMAZON → Business Expense` rule,
  user 2 gets "Business Expense" while user 3 still gets the system rule
  "Shopping".
- Atomic import verified: first commit inserted 10; re-committing the identical
  file inserted 0 and reported 10 duplicates, blocked by the unique index
  rather than by application logic. Reverting the batch removed exactly 10.
- Full-text search verified for stemming (`pharmacy` → "Apollo Pharmacy") and
  quoted phrases (`"indian oil"` matches both a seeded row and an imported one).
- One real bug was found and fixed during testing: `fn_recategorize_user` used
  `UPDATE ... FROM LATERAL` referencing the update target, which Postgres
  rejects. Migration `007` replaces it with a correlated subquery. The route
  was also hardened so a failed retroactive sweep can no longer lose the rule
  that was just created.

### Phases 4–5

- ₹5L prepayment on the seeded home loan: saves ₹8.51L interest and 29 months
  in reduce-tenure mode, versus ₹3.27L in reduce-EMI mode; both simulated
  schedules end at exactly ₹0.00.
- Applying ₹3L funded from an FD left net worth unchanged to the paisa; an
  under-funded attempt failed with nothing written.
- A +25 bps repo change raises the seeded user's floating-rate EMIs by ₹665.37
  a month (about ₹96,295 over the remaining tenure).
- Receipt OCR on a pharmacy bill: 94% confidence in 1.5 s, with merchant, total
  (Grand Total, not Sub Total), date and GSTIN all correct. Confirming the
  same receipt twice returns 201, then 409.
- Defects found and fixed in this phase: prepayment creating net worth from
  nothing; projection overstating the gain after a reduce-tenure prepayment; a
  form `step` that made valid amounts unsubmittable; PDF footers spawning blank
  pages; and a projection chart that was unreadable at scale (now plots the
  difference).

# ArthaTrack

Personal net worth, loan and expense manager for the Indian market.

A hybrid-database full-stack application: **PostgreSQL** holds the transactional
relational core (users, assets, loans, EMI schedules, ledger, snapshots) and
**MongoDB** holds the schema-flexible material (uploaded documents, raw bank
statement imports, per-asset-type valuation history, cached news).

> **Simulated financial data.** ArthaTrack does not connect to any credit
> bureau, bank API, or payment gateway. The credit score module (Phase 4) is a
> metric *derived from this application's own repayment records* — it is not a
> CIBIL/Experian/Equifax score. "Mark EMI paid" records a payment in this
> ledger; it does not move money. See [Simulated vs. real](#simulated-vs-real).

---

## Current status — Phase 1 complete

| Phase | Scope | State |
|---|---|---|
| **1 — Foundation** | Auth & roles, asset CRUD, loan CRUD + generated EMI schedule, manual income/expense ledger | ✅ Built & tested |
| 2 — Analytics | Net worth chart, allocation chart, payoff progress, upcoming dues view | ◻ Next |
| 3 — Import & documents | CSV bank import, receipt OCR, auto-categorisation, document vault | ◻ |
| 4 — Smart features | Prepayment simulator, what-if projection, credit score, product recommender, news feed | ◻ |
| 5 — Polish | FY reporting, PDF statement, EMI reminders | ◻ |

Phase 2's **net worth snapshot trigger** was pulled forward into Phase 1,
because assets and loans are meaningless without something computing net worth
from them.

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
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/arthatrack
MONGODB_URI=mongodb://127.0.0.1:27017      # optional
MONGODB_DB=arthatrack
JWT_SECRET=<at least 32 random characters>  # openssl rand -base64 48
JWT_EXPIRES_IN=7d
```

No credential is ever hard-coded; every one is read from the environment.
`.env` is gitignored.

### 2. Create the database and run migrations

```bash
createdb arthatrack
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
| `priya@arthatrack.dev` | `password123` | Individual — full portfolio |
| `rahul@arthatrack.dev` | `password123` | Individual — smaller portfolio |
| `advisor@arthatrack.dev` | `password123` | Advisor for both |

`npm run db:reset` does a reset migrate + seed in one step.

### 4. Run

```bash
npm run dev          # http://localhost:3000
npm run build && npm start
npm run typecheck
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

```
                        ┌───────────────────────┐
                        │        users          │
                        │ id PK                 │
                        │ name, email UQ        │
                        │ password_hash         │
                        │ role  (individual|    │
                        │        advisor)       │
                        │ pan_number UQ         │
                        │ advisor_id FK ────────┼──┐ self-reference:
                        │ created_at            │◄─┘ advisor → clients
                        └───────────┬───────────┘
        ┌───────────────┬───────────┼───────────────┬────────────────┐
        │               │           │               │                │
        ▼               ▼           ▼               ▼                ▼
┌───────────────┐ ┌───────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐
│    assets     │ │   loans   │ │ transactions │ │ net_worth_   │ │ credit_score_history │
│ id PK         │ │ id PK     │ │ id PK        │ │  snapshots   │ │ id PK                │
│ user_id FK    │ │ user_id FK│ │ user_id FK   │ │ id PK        │ │ user_id FK           │
│ asset_type    │ │ loan_type │ │ txn_type     │ │ user_id FK   │ │ score  300..900      │
│ purchase_value│ │ lender    │ │ amount  >0   │ │ snapshot_date│ │ computed_date        │
│ current_value │ │ principal │ │ txn_date     │ │ total_assets │ │ factors_json  JSONB  │
│ purchase_date │ │ int_rate  │ │ category     │ │ total_liabs  │ │ UQ(user,date)        │
│ valuation_date│ │ int_type  │ │ source       │ │ net_worth    │ └──────────────────────┘
└───────┬───────┘ │ tenure_mo │ │ related_     │ │ UQ(user,date)│
        │         │ start_date│ │  asset_id FK ├─┘              │ ┌──────────────────────┐
        │         │ status    │ │  loan_id  FK ├───┐            │ │    loan_products     │
        │         └─────┬─────┘ │ import_hash  │   │            │ │ id PK                │
        │               │       └──────────────┘   │            │ │ lender, product_name │
        │               ▼                          │            │ │ loan_type            │
        │      ┌────────────────────┐              │            │ │ rate_min .. rate_max │
        │      │   emi_schedule     │◄─────────────┘            │ │ min_credit_score     │
        │      │ id PK              │                           │ │ max_tenure_months    │
        │      │ loan_id FK CASCADE │                           │ │ min/max_amount       │
        │      │ installment_no     │                           │ │ processing_fee_pct   │
        │      │ due_date           │  UQ(loan_id,              │ │ (reference data —    │
        │      │ emi_amount         │      installment_no)      │ │  no user FK)         │
        │      │ principal_component│                           │ └──────────────────────┘
        │      │ interest_component │                           │
        │      │ closing_balance    │                           │
        │      │ status, paid_date  │                           │
        │      └────────────────────┘                           │
        │                                                       │
        └───── MongoDB ─────────────────────────────────────────┘
               asset_valuation_history { userId, assetId, valuationDate,
                                         value, typeSpecificMetadata {…} }
               documents               { userId, refType, refId, fileUrl, tags[] }
               raw_imports             { userId, sourceBank, rawRows[], matchStatus }
               news_articles           { headline, source, category, tags[], body }
```

Cardinality: `users 1—N assets`, `users 1—N loans`, `loans 1—N emi_schedule`,
`users 1—N transactions` (each optionally referencing one asset **or** one loan),
`users 1—N net_worth_snapshots` (one per day), `users 1—N credit_score_history`.
`loan_products` stands alone as reference data.

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

### 6. Indexing

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

### 7. MongoDB

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

Custom Gruvbox-derived palette — no default shadcn or Tailwind colours.

Tokens are CSS variables in `src/app/globals.css`, so light/dark is a single
`data-theme` swap on `<html>`, and `src/lib/chart-colors.ts` resolves the same
variables at runtime — a category is the same colour in the table, the chart and
the legend, in both themes.

| Role | Dark | Light |
|---|---|---|
| Background / raised | `#282828` / `#3c3836` | `#fbf1c7` / `#f9f5d7` |
| Text | `#ebdbb2` | `#3c3836` |
| Primary action | `#fe8019` | `#af3a03` |
| Positive / income | `#b8bb26` | `#79740e` |
| Negative / expense | `#fb4934` | `#9d0006` |
| Warning / due soon | `#fabd2f` | `#b57614` |
| Informational | `#83a598` | `#076678` |

Inter for UI text, **JetBrains Mono with `tabular-nums` for every rupee figure**,
so columns of amounts line up. Flat surfaces, hairline borders, no shadows or
gradients — a ledger, not a SaaS dashboard. Amounts use Indian digit grouping
(`₹92,00,000`, `₹1.04 Cr`), not thousands separators.

Theme choice persists to `localStorage`, and an inline script in
`src/app/layout.tsx` applies it before first paint so there is no flash of the
wrong theme.

---

## Simulated vs. real

| Feature | Reality | What ArthaTrack does |
|---|---|---|
| Credit score | Requires a licensed bureau (CIBIL/Experian/Equifax) | Computes a 300–900 score **from this app's own EMI payment history**, stored in `credit_score_history` with its factor breakdown. Labelled as derived everywhere it appears. |
| "Mark EMI paid" | Requires a payment gateway / bank mandate | Records the payment in this ledger. No money moves. |
| Bank statement import | Requires an account aggregator (RBI AA framework) | User uploads a CSV they downloaded themselves. |
| Asset valuations | Requires market data feeds | User-entered, with history retained. |
| Loan products | Requires lender partnerships | Static seeded catalogue of publicly-advertised rates. |
| News feed | A public news API | Fetched and cached; rate-impact estimates are indicative, not advice. |

ArthaTrack is a personal-finance *record-keeping and analysis* tool. It gives no
financial advice and holds no real account credentials.

---

## Verified behaviour (Phase 1)

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

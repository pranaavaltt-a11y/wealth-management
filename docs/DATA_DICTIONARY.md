# WealthWise — data dictionary

> Generated from the live PostgreSQL catalogue by `npm run docs:generate`. Do not edit by hand.

**11 tables · 11 views · 17 functions · 1 procedure · 8 triggers · 35 indexes**

Key: **PK** primary key · **FK** foreign key · **UQ** unique · **GEN** generated column

## `users`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | bigint | no |  | PK |  |
| `name` | text | no |  |  |  |
| `email` | text | no |  | UQ |  |
| `password_hash` | text | no |  |  |  |
| `role` | user_role | no | `'individual'::user_role` |  |  |
| `pan_number` | char(10) | yes |  | UQ |  |
| `advisor_id` | bigint | yes |  | FK → `users` | Individual users may be assigned to an advisor; advisors have NULL here.; on delete set null |
| `created_at` | timestamptz | no | `now()` |  |  |

**Constraints**

- `users_email_check` — `CHECK (((email = lower(email)) AND (email ~~ '%_@_%._%'::text)))`
- `users_name_check` — `CHECK ((length(TRIM(BOTH FROM name)) > 0))`
- `users_pan_number_check` — `CHECK ((pan_number ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'::text))`

**Indexes**

- `idx_users_advisor` — `USING btree (advisor_id) WHERE (advisor_id IS NOT NULL)`
- `users_email_key` — `UNIQUE USING btree (email)`
- `users_pan_number_key` — `UNIQUE USING btree (pan_number)`
- `users_pkey` — `UNIQUE USING btree (id)`

## `assets`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | bigint | no |  | PK |  |
| `user_id` | bigint | no |  | FK → `users` | on delete cascade |
| `name` | text | no |  |  |  |
| `asset_type` | asset_type | no |  |  |  |
| `purchase_value` | numeric(15,2) | no |  |  |  |
| `current_value` | numeric(15,2) | no |  |  |  |
| `purchase_date` | date | no |  |  |  |
| `valuation_date` | date | no | `CURRENT_DATE` |  |  |
| `notes` | text | yes |  |  |  |
| `created_at` | timestamptz | no | `now()` |  |  |
| `liquidity` | asset_liquidity | no | `'illiquid'::asset_liquidity` |  |  |

**Constraints**

- `assets_current_value_check` — `CHECK ((current_value >= (0)::numeric))`
- `assets_name_check` — `CHECK ((length(TRIM(BOTH FROM name)) > 0))`
- `assets_purchase_value_check` — `CHECK ((purchase_value >= (0)::numeric))`
- `assets_valuation_not_before_purchase` — `CHECK ((valuation_date >= purchase_date))`
- `assets_valuation_not_in_future` — `CHECK ((valuation_date <= (CURRENT_DATE + '1 day'::interval)))`

**Indexes**

- `assets_pkey` — `UNIQUE USING btree (id)`
- `idx_assets_user_type` — `USING btree (user_id, asset_type)`

## `loans`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | bigint | no |  | PK |  |
| `user_id` | bigint | no |  | FK → `users` | on delete cascade |
| `loan_type` | loan_type | no |  |  |  |
| `lender` | text | no |  |  |  |
| `principal` | numeric(15,2) | no |  |  |  |
| `interest_rate` | numeric(5,2) | no |  |  |  |
| `interest_type` | interest_type | no | `'fixed'::interest_type` |  |  |
| `tenure_months` | integer | no |  |  |  |
| `start_date` | date | no |  |  |  |
| `status` | loan_status | no | `'active'::loan_status` |  |  |
| `created_at` | timestamptz | no | `now()` |  |  |

**Constraints**

- `loans_interest_rate_check` — `CHECK (((interest_rate > (0)::numeric) AND (interest_rate <= (60)::numeric)))`
- `loans_lender_check` — `CHECK ((length(TRIM(BOTH FROM lender)) > 0))`
- `loans_principal_check` — `CHECK ((principal > (0)::numeric))`
- `loans_tenure_months_check` — `CHECK (((tenure_months >= 1) AND (tenure_months <= 480)))`

**Indexes**

- `idx_loans_user_status` — `USING btree (user_id, status)`
- `loans_pkey` — `UNIQUE USING btree (id)`

## `emi_schedule`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | bigint | no |  | PK |  |
| `loan_id` | bigint | no |  | FK → `loans` | on delete cascade |
| `installment_no` | integer | no |  |  |  |
| `due_date` | date | no |  |  |  |
| `emi_amount` | numeric(15,2) | no |  |  |  |
| `principal_component` | numeric(15,2) | no |  |  |  |
| `interest_component` | numeric(15,2) | no |  |  |  |
| `closing_balance` | numeric(15,2) | no |  |  |  |
| `status` | emi_status | no | `'pending'::emi_status` |  |  |
| `paid_date` | date | yes |  |  |  |

**Constraints**

- `emi_paid_date_consistency` — `CHECK ((((status = 'paid'::emi_status) AND (paid_date IS NOT NULL)) OR ((status <> 'paid'::emi_status) AND (paid_date IS NULL))))`
- `emi_schedule_closing_balance_check` — `CHECK ((closing_balance >= (0)::numeric))`
- `emi_schedule_emi_amount_check` — `CHECK ((emi_amount > (0)::numeric))`
- `emi_schedule_installment_no_check` — `CHECK ((installment_no > 0))`
- `emi_schedule_interest_component_check` — `CHECK ((interest_component >= (0)::numeric))`
- `emi_schedule_principal_component_check` — `CHECK ((principal_component >= (0)::numeric))`
- `emi_schedule_loan_id_installment_no_key` — `UNIQUE (loan_id, installment_no)`

**Indexes**

- `emi_schedule_loan_id_installment_no_key` — `UNIQUE USING btree (loan_id, installment_no)`
- `emi_schedule_pkey` — `UNIQUE USING btree (id)`
- `idx_emi_due_pending` — `USING btree (due_date) WHERE (status = ANY (ARRAY['pending'::emi_status, 'overdue'::emi_status]))`

## `loan_prepayments`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | bigint | no |  | PK |  |
| `loan_id` | bigint | no |  | FK → `loans` | on delete cascade |
| `amount` | numeric(15,2) | no |  |  |  |
| `after_installment` | integer | no |  |  |  |
| `mode` | text | no |  |  |  |
| `balance_before` | numeric(15,2) | no |  |  |  |
| `balance_after` | numeric(15,2) | no |  |  |  |
| `interest_saved` | numeric(15,2) | no | `0` |  |  |
| `prepaid_on` | date | no | `CURRENT_DATE` |  |  |
| `created_at` | timestamptz | no | `now()` |  |  |

**Constraints**

- `loan_prepayments_after_installment_check` — `CHECK ((after_installment >= 0))`
- `loan_prepayments_amount_check` — `CHECK ((amount > (0)::numeric))`
- `loan_prepayments_balance_after_check` — `CHECK ((balance_after >= (0)::numeric))`
- `loan_prepayments_balance_before_check` — `CHECK ((balance_before > (0)::numeric))`
- `loan_prepayments_mode_check` — `CHECK ((mode = ANY (ARRAY['reduce_tenure'::text, 'reduce_emi'::text])))`
- `prepay_balance_consistent` — `CHECK ((balance_after = (balance_before - amount)))`

**Indexes**

- `idx_prepay_loan` — `USING btree (loan_id, after_installment)`
- `loan_prepayments_pkey` — `UNIQUE USING btree (id)`

## `transactions`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | bigint | no |  | PK |  |
| `user_id` | bigint | no |  | FK → `users` | on delete cascade |
| `txn_type` | txn_type | no |  |  |  |
| `amount` | numeric(15,2) | no |  |  |  |
| `txn_date` | date | no |  |  |  |
| `category` | text | no | `'uncategorized'::text` |  |  |
| `description` | text | yes |  |  |  |
| `source` | txn_source | no | `'manual'::txn_source` |  |  |
| `related_asset_id` | bigint | yes |  | FK → `assets` | on delete set null |
| `related_loan_id` | bigint | yes |  | FK → `loans` | on delete set null |
| `import_hash` | text | yes |  |  |  |
| `created_at` | timestamptz | no | `now()` |  |  |
| `import_batch_id` | text | yes |  |  | MongoDB raw_imports._id as a string. Cross-DB link, not FK-enforced. |
| `search_vector` | tsvector | yes |  | GEN | Generated tsvector; description weighted A, category B. Backed by a GIN index. |

**Constraints**

- `transactions_amount_check` — `CHECK ((amount > (0)::numeric))`

**Indexes**

- `idx_txn_import_batch` — `USING btree (import_batch_id) WHERE (import_batch_id IS NOT NULL)`
- `idx_txn_import_hash` — `UNIQUE USING btree (user_id, import_hash) WHERE (import_hash IS NOT NULL)`
- `idx_txn_search` — `USING gin (search_vector)`
- `idx_txn_user_date` — `USING btree (user_id, txn_date DESC)`
- `idx_txn_user_fy` — `USING btree (user_id, fn_fy_start_year(txn_date))`
- `idx_txn_user_type_category` — `USING btree (user_id, txn_type, category)`
- `transactions_pkey` — `UNIQUE USING btree (id)`

## `net_worth_snapshots`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | bigint | no |  | PK |  |
| `user_id` | bigint | no |  | FK → `users` | on delete cascade |
| `snapshot_date` | date | no | `CURRENT_DATE` |  |  |
| `total_assets` | numeric(15,2) | no |  |  |  |
| `total_liabilities` | numeric(15,2) | no |  |  |  |
| `net_worth` | numeric(15,2) | no |  |  |  |
| `created_at` | timestamptz | no | `now()` |  |  |

**Constraints**

- `net_worth_snapshots_total_assets_check` — `CHECK ((total_assets >= (0)::numeric))`
- `net_worth_snapshots_total_liabilities_check` — `CHECK ((total_liabilities >= (0)::numeric))`
- `net_worth_snapshots_user_id_snapshot_date_key` — `UNIQUE (user_id, snapshot_date)`

**Indexes**

- `net_worth_snapshots_pkey` — `UNIQUE USING btree (id)`
- `net_worth_snapshots_user_id_snapshot_date_key` — `UNIQUE USING btree (user_id, snapshot_date)`

## `credit_score_history`

Simulated in-app credit score derived from WealthWise repayment data. Not a credit bureau score.

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | bigint | no |  | PK |  |
| `user_id` | bigint | no |  | FK → `users` | on delete cascade |
| `score` | integer | no |  |  |  |
| `computed_date` | date | no | `CURRENT_DATE` |  |  |
| `factors_json` | jsonb | no | `'{}'::jsonb` |  |  |
| `created_at` | timestamptz | no | `now()` |  |  |

**Constraints**

- `credit_score_history_score_check` — `CHECK (((score >= 300) AND (score <= 900)))`
- `credit_score_history_user_id_computed_date_key` — `UNIQUE (user_id, computed_date)`

**Indexes**

- `credit_score_history_pkey` — `UNIQUE USING btree (id)`
- `credit_score_history_user_id_computed_date_key` — `UNIQUE USING btree (user_id, computed_date)`
- `idx_credit_score_user_date` — `USING btree (user_id, computed_date DESC)`

## `loan_products`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | bigint | no |  | PK |  |
| `lender` | text | no |  |  |  |
| `product_name` | text | no |  |  |  |
| `loan_type` | loan_type | no |  |  |  |
| `interest_rate_min` | numeric(5,2) | no |  |  |  |
| `interest_rate_max` | numeric(5,2) | no |  |  |  |
| `min_credit_score` | integer | no |  |  |  |
| `max_tenure_months` | integer | no |  |  |  |
| `min_amount` | numeric(15,2) | no |  |  |  |
| `max_amount` | numeric(15,2) | no |  |  |  |
| `processing_fee_pct` | numeric(5,2) | no |  |  |  |
| `is_active` | boolean | no | `true` |  |  |

**Constraints**

- `loan_products_amount_band` — `CHECK ((max_amount >= min_amount))`
- `loan_products_interest_rate_max_check` — `CHECK ((interest_rate_max > (0)::numeric))`
- `loan_products_interest_rate_min_check` — `CHECK ((interest_rate_min > (0)::numeric))`
- `loan_products_max_amount_check` — `CHECK ((max_amount > (0)::numeric))`
- `loan_products_max_tenure_months_check` — `CHECK (((max_tenure_months >= 1) AND (max_tenure_months <= 480)))`
- `loan_products_min_amount_check` — `CHECK ((min_amount >= (0)::numeric))`
- `loan_products_min_credit_score_check` — `CHECK (((min_credit_score >= 300) AND (min_credit_score <= 900)))`
- `loan_products_processing_fee_pct_check` — `CHECK ((processing_fee_pct >= (0)::numeric))`
- `loan_products_rate_band` — `CHECK ((interest_rate_max >= interest_rate_min))`
- `loan_products_lender_product_name_key` — `UNIQUE (lender, product_name)`

**Indexes**

- `idx_loan_products_match` — `USING btree (loan_type, min_credit_score) WHERE is_active`
- `loan_products_lender_product_name_key` — `UNIQUE USING btree (lender, product_name)`
- `loan_products_pkey` — `UNIQUE USING btree (id)`

## `categorization_rules`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | bigint | no |  | PK |  |
| `user_id` | bigint | yes |  | FK → `users` | on delete cascade |
| `keyword` | text | no |  |  |  |
| `category` | text | no |  |  |  |
| `txn_type` | txn_type | no | `'expense'::txn_type` |  |  |
| `priority` | integer | no | `100` |  |  |
| `is_active` | boolean | no | `true` |  |  |
| `created_at` | timestamptz | no | `now()` |  |  |

**Constraints**

- `categorization_rules_category_check` — `CHECK ((length(TRIM(BOTH FROM category)) > 0))`
- `categorization_rules_keyword_check` — `CHECK ((length(TRIM(BOTH FROM keyword)) >= 2))`
- `categorization_rules_priority_check` — `CHECK ((priority > 0))`

**Indexes**

- `categorization_rules_pkey` — `UNIQUE USING btree (id)`
- `idx_catrule_lookup` — `USING btree (priority) WHERE is_active`
- `idx_catrule_system_keyword` — `UNIQUE USING btree (upper(keyword)) WHERE (user_id IS NULL)`
- `idx_catrule_user_keyword` — `UNIQUE USING btree (user_id, upper(keyword)) WHERE (user_id IS NOT NULL)`

## `notifications`

| Column | Type | Null | Default | Key | Notes |
|---|---|---|---|---|---|
| `id` | bigint | no |  | PK |  |
| `user_id` | bigint | no |  | FK → `users` | on delete cascade |
| `kind` | text | no |  |  |  |
| `title` | text | no |  |  |  |
| `body` | text | no |  |  |  |
| `installment_id` | bigint | yes |  | FK → `emi_schedule` | on delete cascade |
| `due_date` | date | yes |  |  |  |
| `is_read` | boolean | no | `false` |  |  |
| `created_at` | timestamptz | no | `now()` |  |  |

**Constraints**

- `notifications_kind_check` — `CHECK ((kind = ANY (ARRAY['emi_due'::text, 'emi_overdue'::text, 'score_change'::text])))`

**Indexes**

- `idx_notif_once` — `UNIQUE USING btree (user_id, kind, installment_id) WHERE (installment_id IS NOT NULL)`
- `idx_notif_unread` — `USING btree (user_id, created_at DESC) WHERE (NOT is_read)`
- `notifications_pkey` — `UNIQUE USING btree (id)`

## Database objects

| Kind | Name |
|---|---|
| function | `fn_calculate_emi` |
| function | `fn_categorize` |
| function | `fn_compute_credit_score` |
| function | `fn_fy_label` |
| function | `fn_fy_start_year` |
| function | `fn_generate_emi_reminders` |
| function | `fn_generate_emi_schedule` |
| function | `fn_loan_outstanding` |
| function | `fn_mark_overdue_emis` |
| function | `fn_project_net_worth` |
| function | `fn_recategorize_user` |
| function | `fn_recommend_loan_products` |
| function | `fn_refresh_net_worth` |
| function | `fn_simulate_prepayment` |
| function | `trg_fn_credit_score_emi` |
| function | `trg_fn_credit_score_loans` |
| function | `trg_fn_refresh_net_worth` |
| procedure | `sp_apply_prepayment` |
| trigger | `trg_assets_net_worth` |
| trigger | `trg_emi_credit_score` |
| trigger | `trg_emi_net_worth` |
| trigger | `trg_loans_net_worth` |
| trigger | `trg_loans_score_del` |
| trigger | `trg_loans_score_ins` |
| trigger | `trg_loans_score_upd` |
| trigger | `trg_prepay_net_worth` |
| view | `v_asset_allocation` |
| view | `v_category_spend` |
| view | `v_fy_category_spend` |
| view | `v_fy_loan_summary` |
| view | `v_fy_summary` |
| view | `v_fy_tax_hints` |
| view | `v_loan_payoff_progress` |
| view | `v_monthly_cashflow` |
| view | `v_net_worth_summary` |
| view | `v_recurring_expenses` |
| view | `v_upcoming_emi_dues` |

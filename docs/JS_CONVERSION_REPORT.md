# WealthWise — TypeScript to JavaScript conversion report

**Summary.** The whole application, previously written in TypeScript, is now
plain **JavaScript (ES2022) with React JSX**, and still runs on **Next.js 14**.
Every one of the 114 source files was converted. Behaviour is unchanged, and
that was verified, not assumed:

| Check | TypeScript (before) | JavaScript (after) |
|---|---|---|
| `next build` | ✅ compiled | ✅ compiled, no warnings |
| Automated tests | 67 / 67 pass | **67 / 67 pass** |
| API responses, 50 calls across every endpoint and error path | baseline | **50 / 50 identical** |
| Browser interactions (charts, theme, simulator, lender comparison, search, CSV import, receipt OCR, news impact, reminders, advisor view) | — | **10 / 10 pass, no runtime errors** |

---

## 1. Why

The course brief (§9) requires a Next.js interface. Next.js is a framework,
and it supports both TypeScript and JavaScript. The project used TypeScript;
the team chose to standardise on JavaScript.

## 2. What changed

### 2.1 Source files

| Area | Files | Before | After |
|---|---|---|---|
| API route handlers | 35 | `route.ts` | `route.js` |
| Pages and layouts | 16 | `page.tsx`, `layout.tsx` | `page.jsx`, `layout.jsx` |
| React components | 24 | `*.tsx` | `*.jsx` |
| Data access, services, auth, validation | 27 | `*.ts` | `*.js` |
| Scripts (migrate, seed, test DB, docs) | 4 | `*.ts` | `*.js` |
| Tests | 7 | `*.test.ts` | `*.test.js` |
| Tailwind config | 1 | `tailwind.config.ts` | `tailwind.config.js` |
| **Total** | **114** | 9,133 lines | 11,582 lines |

The line count rose because type information moved into JSDoc comment blocks
(§3), and the formatter put long signatures on several lines. There is no new
logic.

### 2.2 Configuration

| Item | Change |
|---|---|
| `tsconfig.json` | Replaced by **`jsconfig.json`**, which Next.js reads for the `@/` → `src/` import alias |
| `package.json` dependencies | Removed `typescript` and six `@types/*` packages |
| `package.json` scripts | `typecheck` removed; script and test paths now point at `.js` files |
| Script runner | `tsx` is kept purely as a Node.js runner (it resolves the `@/` alias from `jsconfig.json` via `--tsconfig jsconfig.json`); it executes plain JavaScript here |
| Tailwind | Content globs now scan `src/**/*.{js,jsx}` |
| SQL migration comments | Three comments that said "in TypeScript" now say "in JavaScript" (comments only; the runner tracks migrations by filename, so nothing re-runs) |

### 2.3 Unchanged

The database schema, all 8 migrations, the SQL functions, procedure, triggers
and views, MongoDB usage, the UI and design system, and every API contract.

## 3. Method

The conversion was automated with a purpose-built script, so that every file
was treated identically. It did not simply delete types: it **moved type
information into JSDoc**, the standard way to document types in JavaScript.

1. **Interfaces and type aliases** (78) became JSDoc `@typedef` blocks, each
   field a `@property` that keeps its original inline comment:

   ```js
   /**
    * @typedef {object} VaultDoc
    * @property {number} userId
    * @property {string} fileName - stored name on disk (random, not user-supplied)
    * @property {'loan' | 'asset' | 'general'} refType
    */
   ```

2. **Function signatures** (210 top-level functions) gained `@param`,
   `@returns` and `@template` tags, merged into each function's existing
   explanatory comment:

   ```js
   /**
    * Run a parameterised query. Never interpolate user input into `text`.
    *
    * @template {QueryResultRow} T
    * @param {string} text
    * @param {unknown[]} [params=[]]
    * @returns {Promise<T[]>}
    */
   export async function query(text, params = []) {
   ```

3. **TypeScript-only syntax with runtime meaning.** Five constructor
   *parameter properties* in four error classes (`constructor(readonly status: number)`)
   were rewritten as explicit assignments (`this.status = status`). There were
   no enums, namespaces or decorators.

4. **Type-only imports** were identified with the TypeScript type checker
   itself, not by guesswork, so that no import of a type that has no runtime
   value survives into JavaScript. All 114 files already marked these with
   `import type`, so none needed rewriting.

5. **Remaining annotations** (`: string`, `as const`, generics, `!`) were
   erased with `ts-blank-space`, which preserves every comment and blank line.
   The output was then formatted with Prettier.

6. String literals were checked separately (the converter does not alter
   them). One path, `scripts/migrate.ts` inside the test-database script, was
   corrected by hand.

## 4. Verification

### 4.1 Baseline before conversion

On a freshly migrated and seeded database, with the TypeScript code: built,
ran all 67 tests (pass), and recorded the responses of **50 API calls** —
every endpoint for all three roles (individual, second individual, advisor),
the read-only POST endpoints (lender recommendations, prepayment simulation,
CSV preview, receipt OCR), the PDF statement, every page, and every error path
(401 unauthenticated, 403 wrong role, 403 other user's data, 404 other user's
loan, 409 editing a paid loan, 415 bad upload, 422 invalid input, 401 wrong
password). Timestamps were stripped so the comparison is about content.

### 4.2 After conversion

| Check | Result |
|---|---|
| `next build` from a clean `.next` | Compiled successfully, no warnings |
| No TypeScript left | 0 `.ts` / `.tsx` files; Next.js did not regenerate a `tsconfig.json` |
| Unit tests | 28 / 28 |
| Database integration tests | 39 / 39 |
| Same 50 API calls, same database | **50 / 50 identical** to the baseline |
| Browser: charts render, theme toggle, prepayment simulator, lender comparison, full-text search, CSV import preview, receipt OCR, news rate impact, notification bell, advisor client list | **10 / 10 pass** |
| Browser console and runtime errors across every page | None. The only failed request is `favicon.ico`, which the project has never had. |

## 5. Trade-off

The one thing JavaScript gives up is **compile-time type checking**: a
mistake such as passing a string where a number is expected is no longer
caught before the code runs. For this project the risk is contained, because
the checks that guard data were never the compiler's job:

- **API input** is validated at runtime by Zod schemas in every route handler.
- **Stored data** is guarded by 41 CHECK constraints, NOT NULL, UNIQUE and 13
  foreign keys in PostgreSQL.
- **Business rules** (locked schedules, prepayment limits, ownership) are
  enforced inside stored functions and procedures.
- **Regressions** are caught by the 67-test suite.

JSDoc keeps editor support: hovering a function in VS Code still shows its
parameter and return types.

## 6. Running the JavaScript version

Nothing changes for the person running it:

```bash
npm install
npm run db:migrate && npm run db:seed
npm run dev            # http://localhost:3000
npm test               # 67 tests
```

## 7. Note for the team

The branch `claude/sprint-2-backup-accessibility-o6iv0m` on GitHub adds a
backup/restore service and accessibility checks to WealthWise, written in
**TypeScript**. It was never merged into the main project branch, so it was
not part of this conversion. If you merge it, its six new `.ts` files will
need converting the same way.

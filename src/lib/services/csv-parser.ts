import { createHash } from 'node:crypto';

/**
 * Bank statement CSV parsing.
 *
 * Indian banks do not agree on a statement format. HDFC writes
 * "Withdrawal Amt." / "Deposit Amt."; ICICI writes "Debit"/"Credit"; SBI writes
 * "Debit"/"Credit" with a different date order; several prepend junk lines
 * before the real header. So rather than hardcoding one layout, the header row
 * is located by scanning, and columns are matched by alias.
 */

// ------------------------------------------------------------------ parsing

/**
 * RFC 4180 CSV reader, hand-rolled rather than pulled from npm because bank
 * files routinely contain commas inside quoted narrations ("NEFT CR, SALARY")
 * and a naive split() corrupts exactly the column we care about.
 * Handles quoted fields, escaped quotes (""), and CRLF or LF line endings.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }   // escaped quote
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') { inQuotes = true; }
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\r') { /* handled by the \n that follows */ }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else { field += ch; }
  }

  // Trailing field/row with no terminating newline.
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// ------------------------------------------------------- column detection

/** Header aliases seen across HDFC, ICICI, SBI, Axis and Kotak exports. */
const ALIASES = {
  date: ['date', 'txn date', 'transaction date', 'value date', 'tran date', 'posting date'],
  description: ['narration', 'description', 'particulars', 'transaction remarks', 'remarks', 'details'],
  debit: ['withdrawal amt.', 'withdrawal amt', 'withdrawal', 'debit', 'debit amount', 'dr', 'withdrawal (dr)'],
  credit: ['deposit amt.', 'deposit amt', 'deposit', 'credit', 'credit amount', 'cr', 'deposit (cr)'],
  amount: ['amount', 'txn amount', 'transaction amount'],
  balance: ['closing balance', 'balance', 'running balance'],
  reference: ['chq./ref.no.', 'ref no', 'reference', 'cheque no', 'chq no'],
} as const;

type Column = keyof typeof ALIASES;

const normaliseHeader = (h: string) => h.trim().toLowerCase().replace(/\s+/g, ' ');

function matchColumn(header: string): Column | null {
  const h = normaliseHeader(header);
  for (const [col, aliases] of Object.entries(ALIASES) as [Column, readonly string[]][]) {
    if (aliases.some((a) => h === a)) return col;
  }
  // Fall back to a contains match, so "Withdrawal Amt (INR)" still resolves.
  for (const [col, aliases] of Object.entries(ALIASES) as [Column, readonly string[]][]) {
    if (aliases.some((a) => h.includes(a))) return col;
  }
  return null;
}

/**
 * Finds the header row. Banks often precede it with account-holder blurb, so
 * the first row that maps to both a date and a description column wins.
 */
export function findHeader(rows: string[][]): { index: number; map: Partial<Record<Column, number>> } | null {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const map: Partial<Record<Column, number>> = {};
    rows[i].forEach((cell, idx) => {
      const col = matchColumn(cell);
      if (col && map[col] === undefined) map[col] = idx;
    });
    const hasAmount = map.debit !== undefined || map.credit !== undefined || map.amount !== undefined;
    if (map.date !== undefined && map.description !== undefined && hasAmount) {
      return { index: i, map };
    }
  }
  return null;
}

// ------------------------------------------------------------ value coercion

/**
 * Indian statements use dd/mm/yyyy or dd-mm-yy; a few use yyyy-mm-dd.
 * Returns an ISO date, or null when unparseable.
 *
 * Day-first is assumed for the ambiguous dd/mm vs mm/dd case, because these are
 * Indian bank exports. 05/03/2026 is 5 March, not 3 May.
 */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (!m) return null;

  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += year < 70 ? 2000 : 1900;

  if (day < 1 || day > 31 || month < 1 || month > 12) return null;

  const d = new Date(Date.UTC(year, month - 1, day));
  // Rejects 31/02: the Date constructor would silently roll it into March.
  if (d.getUTCDate() !== day || d.getUTCMonth() !== month - 1) return null;

  return d.toISOString().slice(0, 10);
}

/** Strips ₹, thousands separators, CR/DR suffixes and stray spaces. */
export function parseAmount(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[₹,\s]/g, '').replace(/(cr|dr)$/i, '').trim();
  if (!cleaned || cleaned === '-') return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? Math.abs(n) : null;
}

// ------------------------------------------------------------ normalisation

export interface ParsedRow {
  rowNumber: number;
  txnDate: string;
  description: string;
  amount: number;
  txnType: 'income' | 'expense';
  reference: string | null;
  importHash: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  skipped: { rowNumber: number; reason: string; raw: string[] }[];
  detectedColumns: string[];
  headerRow: number;
}

/**
 * Dedupe key. Two statements downloaded a week apart overlap, and re-importing
 * must not double-count. The hash covers the fields that identify a
 * transaction, with the description whitespace-collapsed and upper-cased so
 * trivial formatting differences between exports do not defeat it.
 *
 * Scoped per user by the UNIQUE index on (user_id, import_hash), so two users
 * with an identical transaction do not collide.
 */
export function importHash(txnDate: string, amount: number, description: string): string {
  const key = [txnDate, amount.toFixed(2), description.replace(/\s+/g, ' ').trim().toUpperCase()].join('|');
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

export function normaliseStatement(text: string): ParseResult {
  const raw = parseCsv(text);
  const header = findHeader(raw);
  if (!header) {
    throw new Error(
      'Could not find a header row. Expected columns for date, description and an amount ' +
      '(Withdrawal/Deposit, Debit/Credit, or Amount).',
    );
  }

  const { index, map } = header;
  const rows: ParsedRow[] = [];
  const skipped: ParseResult['skipped'] = [];
  const seen = new Set<string>();

  for (let i = index + 1; i < raw.length; i++) {
    const cells = raw[i];
    const rowNumber = i + 1;
    const get = (c: Column) => (map[c] === undefined ? '' : (cells[map[c]!] ?? '').trim());

    const txnDate = parseDate(get('date'));
    if (!txnDate) { skipped.push({ rowNumber, reason: 'Unreadable or missing date', raw: cells }); continue; }

    const description = get('description').replace(/\s+/g, ' ').trim();
    if (!description) { skipped.push({ rowNumber, reason: 'Missing description', raw: cells }); continue; }

    const debit = parseAmount(get('debit'));
    const credit = parseAmount(get('credit'));
    const single = parseAmount(get('amount'));

    let amount: number | null = null;
    let txnType: 'income' | 'expense' = 'expense';

    if (debit && debit > 0) { amount = debit; txnType = 'expense'; }
    else if (credit && credit > 0) { amount = credit; txnType = 'income'; }
    else if (single && single > 0) {
      // Single-column format: the sign, or a trailing CR, carries direction.
      const rawAmount = get('amount');
      const isCredit = /cr\s*$/i.test(rawAmount) || !rawAmount.trim().startsWith('-');
      amount = single;
      txnType = isCredit ? 'income' : 'expense';
    }

    if (!amount || amount <= 0) {
      skipped.push({ rowNumber, reason: 'No usable amount', raw: cells });
      continue;
    }

    const hash = importHash(txnDate, amount, description);
    // Guard against duplicates inside the same file, before we ever reach the
    // database — the DB index catches cross-file repeats.
    if (seen.has(hash)) {
      skipped.push({ rowNumber, reason: 'Duplicate row within this file', raw: cells });
      continue;
    }
    seen.add(hash);

    rows.push({
      rowNumber,
      txnDate,
      description,
      amount,
      txnType,
      reference: get('reference') || null,
      importHash: hash,
    });
  }

  return {
    rows,
    skipped,
    detectedColumns: Object.keys(map),
    headerRow: index + 1,
  };
}

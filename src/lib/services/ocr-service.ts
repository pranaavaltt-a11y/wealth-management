import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Worker } from 'tesseract.js';
import { parseDate } from './csv-parser';

/**
 * Receipt OCR with Tesseract.js, running on the server.
 *
 * The English model comes from the @tesseract.js-data/eng npm package, so no
 * language data is fetched at runtime and no receipt image is sent to any
 * third-party service — a deliberate choice for financial documents. The
 * trade-off is accuracy: a cloud OCR (Google Vision, Textract) reads crumpled
 * thermal paper far better. That is why every extracted field is shown to the
 * user to confirm before anything is saved.
 */

const LANG_PATH = join(process.cwd(), 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int');

const globalForOcr = globalThis as unknown as { __wwOcr?: Promise<Worker> };

/** One long-lived worker: initialising Tesseract costs ~1–2s, recognising far less. */
async function worker(): Promise<Worker> {
  globalForOcr.__wwOcr ??= (async () => {
    const { createWorker } = await import('tesseract.js');
    return createWorker('eng', 1, {   // OEM 1 = LSTM engine, matching the best_int model
      langPath: LANG_PATH,
      gzip: true,
      cachePath: tmpdir(),              // never write the unpacked model into the repo
    });
  })();
  return globalForOcr.__wwOcr;
}

export async function recogniseImage(image: Buffer): Promise<{ text: string; confidence: number }> {
  const w = await worker();
  const { data } = await w.recognize(image);
  return { text: data.text, confidence: Math.round(data.confidence) };
}

// --------------------------------------------------------- field extraction

export interface ReceiptFields {
  merchant: string | null;
  amount: number | null;
  date: string | null;
  gstin: string | null;
  amountSource: 'total-line' | 'largest-number' | null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Header noise that is never the merchant's name. */
const NOT_MERCHANT = /^(tax\s*invoice|invoice|bill|receipt|cash\s*memo|gstin|gst|phone|ph|tel|mob|date|time|order|table|welcome|thank)/i;

/** Amount words in priority order: grand total beats net amount beats total. */
const TOTAL_PATTERNS: RegExp[] = [
  /grand\s*total/i,
  /(net|bill)\s*(amount|amt|payable)/i,
  /amount\s*(payable|due|paid)/i,
  /\btotal\b(?!\s*(qty|quantity|items?|savings?|discount))/i,
];

/** "1,234.50" / "1234" / "₹ 450.00" -> number. Indian grouping is fine: commas are stripped. */
function toAmount(raw: string): number | null {
  const n = Number.parseFloat(raw.replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? n : null;
}

function amountsOn(line: string): number[] {
  // Money-shaped tokens only: digits with optional Indian/Western grouping and
  // optional paise. A bare "2" in "2 items" is not a total, so very small
  // integers without decimals are ignored.
  const matches = line.match(/\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/g) ?? [];
  return matches
    .map((m) => ({ raw: m, n: toAmount(m) }))
    .filter((m): m is { raw: string; n: number } => m.n !== null && (m.raw.includes('.') || m.n >= 10))
    .map((m) => m.n);
}

function findDate(text: string): string | null {
  const numeric = text.match(/\b(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})\b/);
  if (numeric) {
    const iso = parseDate(numeric[1]);
    if (iso) return iso;
  }
  // "12 Aug 2026", "12-Aug-26"
  const dmy = text.match(/\b(\d{1,2})[\s\-]([A-Za-z]{3,4})[a-z]*[\s\-,]+(\d{2,4})\b/);
  if (dmy && MONTHS[dmy[2].toLowerCase()]) {
    return parseDate(`${dmy[1]}/${MONTHS[dmy[2].toLowerCase()]}/${dmy[3]}`);
  }
  // "Aug 12, 2026"
  const mdy = text.match(/\b([A-Za-z]{3,4})[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (mdy && MONTHS[mdy[1].toLowerCase()]) {
    return parseDate(`${mdy[2]}/${MONTHS[mdy[1].toLowerCase()]}/${mdy[3]}`);
  }
  return null;
}

/**
 * Pulls merchant, total, date and GSTIN out of raw OCR text. Pure, so it is
 * unit-tested directly against sample receipt text in tests/.
 */
export function extractReceiptFields(text: string): ReceiptFields {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Merchant: the first line near the top that reads like a name.
  const merchant = lines.slice(0, 6).find((l) =>
    /[A-Za-z]{3,}/.test(l) && !NOT_MERCHANT.test(l) && !/^\d/.test(l) && l.length <= 60,
  ) ?? null;

  // Total: walk the patterns in priority order; on a matching line the amount
  // is the LAST number (labels come first, figures are right-aligned).
  let amount: number | null = null;
  let amountSource: ReceiptFields['amountSource'] = null;
  for (const pattern of TOTAL_PATTERNS) {
    // Prefer the last matching line: subtotals usually sit above the total.
    const hits = lines.filter((l) => pattern.test(l) && !/sub\s*-?\s*total/i.test(l));
    for (const line of hits.reverse()) {
      const nums = amountsOn(line);
      if (nums.length) { amount = nums[nums.length - 1]; amountSource = 'total-line'; break; }
    }
    if (amount !== null) break;
  }
  if (amount === null) {
    const all = lines.flatMap(amountsOn);
    if (all.length) { amount = Math.max(...all); amountSource = 'largest-number'; }
  }

  const gstin = text.toUpperCase().match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/)?.[0] ?? null;

  return {
    merchant: merchant ? merchant.replace(/\s{2,}/g, ' ').slice(0, 80) : null,
    amount,
    date: findDate(text),
    gstin,
    amountSource,
  };
}

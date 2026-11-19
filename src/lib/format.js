/** Presentation helpers. No business logic — formatting only. */

/**
 * ₹12,34,567.00 — Indian digit grouping (lakh/crore), not thousands.
 *
 * @param {number} value
 * @param {{ decimals?: boolean, compact?: boolean }} [opts={}]
 * @returns {string}
 */
export function formatINR(value, opts = {}) {
  if (!Number.isFinite(value)) return '—';
  if (opts.compact) {
    const abs = Math.abs(value);
    if (abs >= 1e7) return `${value < 0 ? '-' : ''}₹${(abs / 1e7).toFixed(2)} Cr`;
    if (abs >= 1e5) return `${value < 0 ? '-' : ''}₹${(abs / 1e5).toFixed(2)} L`;
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: opts.decimals === false ? 0 : 2,
    maximumFractionDigits: opts.decimals === false ? 0 : 2,
  }).format(value);
}

/**
 * @param {string | null | undefined} iso
 * @returns {string}
 */
export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * @param {number} value
 * @param {number} [digits=1]
 * @returns {string}
 */
export function formatPct(value, digits = 1) {
  return `${value >= 0 ? '' : ''}${value.toFixed(digits)}%`;
}

/** Financial acronyms that must stay upper-case, not Title-cased. */
const ACRONYMS = new Set(['epf', 'ppf', 'fd', 'emi', 'nps', 'sip', 'pan', 'reit']);

/**
 * snake_case enum -> display label, preserving acronyms (epf -> EPF).
 *
 * @param {string} value
 * @returns {string}
 */
export function titleCase(value) {
  return value
    .split(/[_\s]+/)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * Indian financial year containing `date`: Apr 1 -> Mar 31.
 *
 * @param {*} [date=new Date()]
 * @returns {{ label: string, start: string, end: string }}
 */
export function financialYear(date = new Date()) {
  const y = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return {
    label: `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`,
    start: `${y}-04-01`,
    end: `${y + 1}-03-31`,
  };
}

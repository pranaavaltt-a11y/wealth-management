'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Card, Empty, ErrorNote, Badge, Stat } from '@/components/ui';
import { formatINR, formatDate, titleCase } from '@/lib/format';

interface PreviewRow {
  rowNumber: number; txnDate: string; description: string; amount: number;
  txnType: 'income' | 'expense'; category: string; matchedKeyword: string | null;
  importHash: string; duplicate: boolean;
}
interface Preview {
  batchId: string | null; mongoAvailable: boolean; fileName: string; sourceBank: string;
  headerRow: number; detectedColumns: string[];
  rows: PreviewRow[];
  skipped: { rowNumber: number; reason: string }[];
  summary: {
    parsed: number; newRows: number; duplicates: number; skipped: number;
    totalIncome: number; totalExpense: number; uncategorised: number;
  };
}

const CATEGORIES = [
  'Salary', 'Business Income', 'Rent Received', 'Interest Income', 'Dividend',
  'Groceries', 'Dining', 'Fuel', 'Transport', 'Travel', 'Utilities',
  'Mobile & Internet', 'Shopping', 'Entertainment', 'Healthcare', 'Education',
  'Insurance', 'EMI Payment', 'Investment', 'Cash Withdrawal', 'Household Help',
  'Rent Paid', 'Uncategorized',
];

export function ImportView() {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ inserted: number; duplicatesSkipped: number } | null>(null);

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const input = form.elements.namedItem('file') as HTMLInputElement;
    if (!input.files?.[0]) return;

    setBusy(true); setError(null); setDone(null);
    try {
      const fd = new FormData();
      fd.append('file', input.files[0]);
      // Not api.post(): FormData must set its own multipart boundary, so the
      // JSON Content-Type header the helper adds would break the upload.
      const res = await fetch('/api/imports/preview', { method: 'POST', body: fd });
      const body = await res.json();
      if (!res.ok || body.error) throw new ApiError(res.status, body.error ?? 'Upload failed');

      const p: Preview = body.preview;
      setPreview(p);
      setRows(p.rows);
      // Duplicates start unticked — importing them again is almost never wanted.
      setSelected(new Set(p.rows.filter((r) => !r.duplicate).map((r) => r.importHash)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  }

  function setCategory(hash: string, category: string) {
    setRows((prev) => prev.map((r) => (r.importHash === hash ? { ...r, category } : r)));
  }

  function toggle(hash: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(hash) ? next.delete(hash) : next.add(hash);
      return next;
    });
  }

  async function commit() {
    if (!preview || selected.size === 0) return;
    setBusy(true); setError(null);
    try {
      const payload = rows
        .filter((r) => selected.has(r.importHash))
        .map(({ txnDate, description, amount, txnType, category, importHash }) => ({
          txnDate, description, amount, txnType, category, importHash,
        }));
      const result = await api.post<{ inserted: number; duplicatesSkipped: number }>(
        '/api/imports/commit', { batchId: preview.batchId, rows: payload },
      );
      setDone(result);
      setPreview(null);
      setRows([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed — nothing was saved.');
    } finally {
      setBusy(false);
    }
  }

  const selectedRows = rows.filter((r) => selected.has(r.importHash));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Import bank statement</h1>
        <p className="mt-0.5 text-xs text-fg-muted">
          Export a CSV from your net banking. HDFC, ICICI, SBI, Axis and Kotak layouts are detected
          automatically — columns are matched by name, not by position.
        </p>
      </div>

      <ErrorNote message={error} />

      {done && (
        <Card>
          <p className="text-sm">
            <span className="tnum font-semibold text-positive">{done.inserted} transactions imported.</span>
            {done.duplicatesSkipped > 0 && (
              <span className="tnum ml-2 text-fg-muted">
                {done.duplicatesSkipped} skipped as duplicates.
              </span>
            )}
          </p>
        </Card>
      )}

      {!preview && (
        <Card title="Upload">
          <form onSubmit={upload} className="flex flex-wrap items-end gap-3">
            <div className="grow">
              <label className="label" htmlFor="file">Statement file (.csv, max 5MB)</label>
              <input id="file" name="file" type="file" accept=".csv,text/csv" required
                     className="input file:mr-3 file:border-0 file:bg-bg-inset file:px-2 file:py-1 file:text-xs file:text-fg" />
            </div>
            <button type="submit" disabled={busy} className="btn btn-primary">
              {busy ? 'Parsing…' : 'Parse statement'}
            </button>
          </form>
          <p className="mt-2 text-[11px] text-fg-faint">
            Nothing is saved until you review and confirm. Rows you already have are detected and
            unticked automatically.
          </p>
        </Card>
      )}

      {preview && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="New rows" value={preview.summary.newRows} />
            <Stat label="Money in" value={preview.summary.totalIncome} compact />
            <Stat label="Money out" value={preview.summary.totalExpense} compact />
            <Stat label="Net" value={preview.summary.totalIncome - preview.summary.totalExpense} signed compact />
          </div>

          <Card title={`Review — ${preview.fileName}`}>
            <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fg-muted">
              <span>Bank detected: <span className="text-fg">{preview.sourceBank}</span></span>
              <span>Header found on row <span className="tnum text-fg">{preview.headerRow}</span></span>
              <span>Columns: <span className="tnum text-fg">{preview.detectedColumns.join(', ')}</span></span>
              <span>
                Raw rows staged in Mongo:{' '}
                <span className={preview.mongoAvailable ? 'text-positive' : 'text-warning'}>
                  {preview.mongoAvailable ? 'yes' : 'unavailable — importing anyway'}
                </span>
              </span>
            </div>

            {preview.summary.uncategorised > 0 && (
              <p className="mb-3 border border-warning px-3 py-2 text-xs text-warning">
                {preview.summary.uncategorised} row(s) could not be categorised automatically.
                Set a category below, or add a keyword rule so future imports match it.
              </p>
            )}

            <div className="max-h-[30rem] overflow-auto">
              <table className="table">
                <thead className="sticky top-0 bg-bg-raised">
                  <tr>
                    <th className="w-8">
                      <input
                        type="checkbox"
                        checked={selected.size === rows.length && rows.length > 0}
                        onChange={(e) => setSelected(e.target.checked
                          ? new Set(rows.map((r) => r.importHash))
                          : new Set())}
                        aria-label="Select all rows"
                      />
                    </th>
                    <th>Date</th><th>Description</th><th>Category</th>
                    <th className="text-right">Amount</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.importHash} className={r.duplicate ? 'opacity-55' : ''}>
                      <td>
                        <input type="checkbox" checked={selected.has(r.importHash)}
                               onChange={() => toggle(r.importHash)}
                               aria-label={`Include ${r.description}`} />
                      </td>
                      <td className="tnum whitespace-nowrap text-xs">{formatDate(r.txnDate)}</td>
                      <td className="max-w-[22rem] truncate text-xs" title={r.description}>{r.description}</td>
                      <td>
                        <select value={r.category} onChange={(e) => setCategory(r.importHash, e.target.value)}
                                className="select w-auto py-0.5 text-xs">
                          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        {r.matchedKeyword && (
                          <span className="ml-1.5 text-[10px] text-fg-faint">via {r.matchedKeyword}</span>
                        )}
                      </td>
                      <td className={`tnum text-right ${r.txnType === 'income' ? 'text-positive' : 'text-negative'}`}>
                        {r.txnType === 'income' ? '+' : '−'}{formatINR(r.amount)}
                      </td>
                      <td>{r.duplicate ? <Badge value="duplicate" /> : <Badge value={r.txnType} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.skipped.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-fg-muted">
                  {preview.skipped.length} row(s) skipped while parsing
                </summary>
                <ul className="mt-1.5 space-y-0.5">
                  {preview.skipped.map((s) => (
                    <li key={s.rowNumber} className="tnum text-[11px] text-fg-faint">
                      Row {s.rowNumber}: {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
              <button onClick={commit} disabled={busy || selected.size === 0} className="btn btn-primary">
                {busy ? 'Importing…' : `Import ${selected.size} transaction${selected.size === 1 ? '' : 's'}`}
              </button>
              <button onClick={() => { setPreview(null); setRows([]); }} className="btn">Cancel</button>
              <span className="tnum ml-auto text-xs text-fg-muted">
                {formatINR(selectedRows.filter((r) => r.txnType === 'income').reduce((s, r) => s + r.amount, 0))} in ·{' '}
                {formatINR(selectedRows.filter((r) => r.txnType === 'expense').reduce((s, r) => s + r.amount, 0))} out
              </span>
            </div>
            <p className="mt-2 text-[11px] text-fg-faint">
              All selected rows are inserted in a single database transaction — either every row lands
              or none does. Duplicates are blocked by a unique index on (user_id, import_hash), so a
              second import of the same statement cannot double-count.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

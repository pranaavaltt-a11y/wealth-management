'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/client';
import { Card, ErrorNote } from '@/components/ui';
import { formatINR } from '@/lib/format';

interface Fields {
  merchant: string | null; amount: number | null; date: string | null;
  gstin: string | null; category: string; amountSource: string | null;
}

const CATEGORIES = [
  'Groceries', 'Dining', 'Fuel', 'Transport', 'Travel', 'Utilities', 'Mobile & Internet',
  'Shopping', 'Entertainment', 'Healthcare', 'Education', 'Insurance', 'Household Help', 'Uncategorized',
];

async function postForm<T>(url: string, fd: FormData): Promise<T> {
  // FormData sets its own multipart boundary, so no Content-Type header here.
  const res = await fetch(url, { method: 'POST', body: fd });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new ApiError(res.status, body.error ?? 'Request failed');
  return body as T;
}

export function ReceiptScan() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fields, setFields] = useState<Fields | null>(null);
  const [text, setText] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function pick(f: File | null) {
    setFile(f); setFields(null); setSaved(null); setError(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  async function scan() {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await postForm<{ fields: Fields; text: string; confidence: number }>('/api/receipts/scan', fd);
      setFields(r.fields); setText(r.text); setConfidence(r.confidence);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read that image.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData(e.currentTarget);
      fd.append('file', file);
      const r = await postForm<{ filedInVault: boolean }>('/api/receipts/confirm', fd);
      setSaved(`Expense saved${r.filedInVault ? ' and the receipt filed in your vault' : ''}.`);
      setFields(null); pick(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the expense.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <ErrorNote message={error} />
      {saved && <p className="text-sm text-positive">{saved}</p>}

      <Card title="Scan a receipt">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grow">
            <label className="label" htmlFor="rc-file">Photo of the receipt (JPEG, PNG or WebP, max 8MB)</label>
            <input id="rc-file" type="file" accept="image/jpeg,image/png,image/webp"
                   onChange={(e) => pick(e.target.files?.[0] ?? null)}
                   className="input file:mr-3 file:rounded file:border-0 file:bg-bg-inset file:px-2 file:py-1 file:text-xs file:text-fg" />
          </div>
          <button onClick={scan} disabled={!file || busy} className="btn btn-primary">
            {busy && !fields ? 'Reading…' : 'Read receipt'}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-fg-faint">
          Text is read on the WealthWise server with Tesseract; the image is not sent to any outside service.
          You check every field before anything is saved.
        </p>
      </Card>

      {fields && (
        <div className="grid gap-4 lg:grid-cols-5">
          <Card title="Receipt" className="lg:col-span-2">
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Uploaded receipt" className="max-h-[28rem] w-full rounded-md border object-contain" />
            )}
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-fg-muted">Recognised text · {confidence}% confidence</summary>
              <pre className="tnum mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-bg-inset p-2 text-[11px]">{text}</pre>
            </details>
          </Card>

          <Card title="Check and confirm" className="lg:col-span-3">
            {confidence < 70 && (
              <p className="mb-3 rounded-md border border-warning px-3 py-2 text-xs text-warning">
                Low recognition confidence — check every field carefully.
              </p>
            )}
            <form onSubmit={confirm} className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label" htmlFor="rc-m">Merchant</label>
                <input id="rc-m" name="merchant" required defaultValue={fields.merchant ?? ''} className="input" />
              </div>
              <div>
                <label className="label" htmlFor="rc-a">Amount (₹)</label>
                <input id="rc-a" name="amount" type="number" step="0.01" min="0.01" required
                       defaultValue={fields.amount ?? ''} className="input tnum" />
                <div className="mt-1 text-[11px] text-fg-faint">
                  {fields.amountSource === 'total-line' ? 'Taken from the total line'
                    : fields.amountSource === 'largest-number' ? 'No total line found — largest amount used, please check'
                    : 'Not found — enter it'}
                </div>
              </div>
              <div>
                <label className="label" htmlFor="rc-d">Date</label>
                <input id="rc-d" name="txnDate" type="date" required
                       defaultValue={fields.date ?? new Date().toISOString().slice(0, 10)} className="input tnum" />
              </div>
              <div>
                <label className="label" htmlFor="rc-c">Category</label>
                <select id="rc-c" name="category" defaultValue={fields.category} className="select">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="label">GSTIN</label>
                <div className="tnum py-1.5 text-sm text-fg-muted">{fields.gstin ?? 'not found'}</div>
              </div>
              <label className="flex items-center gap-2 text-xs text-fg-muted sm:col-span-2">
                <input type="checkbox" name="keepImage" value="true" defaultChecked /> Keep the receipt image in my vault
              </label>
              <div className="flex gap-2 sm:col-span-2">
                <button type="submit" disabled={busy} className="btn btn-primary">
                  {busy ? 'Saving…' : `Save expense${fields.amount ? ` of ${formatINR(fields.amount)}` : ''}`}
                </button>
                <button type="button" onClick={() => { setFields(null); pick(null); }} className="btn">Discard</button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/client';
import { Card, Empty, ErrorNote, Badge } from '@/components/ui';
import { formatDate, titleCase } from '@/lib/format';

interface Doc {
  _id: string; refType: string; refId: number | null; title: string;
  originalName: string; fileUrl: string; mimeType: string; sizeBytes: number;
  tags: string[]; uploadedAt: string;
}
interface Stats {
  byType: { refType: string; count: number; bytes: number }[];
  byTag: { tag: string; count: number }[];
}

const kb = (b: number) => (b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export function VaultView() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [available, setAvailable] = useState(true);
  const [search, setSearch] = useState('');
  const [refType, setRefType] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (search) qs.set('search', search);
      if (refType !== 'all') qs.set('refType', refType);
      const res = await api.get<{ available: boolean; documents: Doc[]; stats: Stats | null }>(
        `/api/vault?${qs}`,
      );
      setAvailable(res.available);
      setDocs(res.documents);
      setStats(res.stats);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the vault.');
    }
  }, [search, refType]);

  useEffect(() => { void load(); }, [load]);

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/vault', { method: 'POST', body: new FormData(form) });
      const body = await res.json();
      if (!res.ok || body.error) throw new ApiError(res.status, body.error ?? 'Upload failed');
      form.reset();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this document? The file is removed from disk too.')) return;
    try {
      await api.del(`/api/vault/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete.');
    }
  }

  if (!available) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Document vault</h1>
        <Card>
          <p className="text-sm text-warning">MongoDB is not reachable.</p>
          <p className="mt-1.5 text-xs text-fg-muted">
            The vault stores document metadata in MongoDB, because what matters differs per document
            type — a sale deed carries survey and registration details, a sanction letter carries a
            reference number and sanction date. Set <span className="tnum">MONGODB_URI</span> in{' '}
            <span className="tnum">.env</span> and restart to enable it. Everything else in WealthWise
            works without it.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Document vault</h1>
        <p className="mt-0.5 text-xs text-fg-muted">
          Loan sanction letters, sale deeds, insurance policies and receipts — tagged and searchable.
        </p>
      </div>

      <ErrorNote message={error} />

      <Card title="Upload a document">
        <form onSubmit={upload} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <label className="label" htmlFor="v-file">File (PDF or image, max 10MB)</label>
            <input id="v-file" name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,.webp"
                   className="input file:mr-3 file:border-0 file:bg-bg-inset file:px-2 file:py-1 file:text-xs file:text-fg" />
          </div>
          <div>
            <label className="label" htmlFor="v-title">Title</label>
            <input id="v-title" name="title" className="input" placeholder="HDFC sanction letter" />
          </div>
          <div>
            <label className="label" htmlFor="v-type">Attach to</label>
            <select id="v-type" name="refType" className="select" defaultValue="general">
              <option value="general">Nothing in particular</option>
              <option value="loan">A loan</option>
              <option value="asset">An asset</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="v-tags">Tags (comma separated)</label>
            <input id="v-tags" name="tags" className="input" placeholder="loan, hdfc, 2026" />
          </div>
          <div className="sm:col-span-2 lg:col-span-5">
            <button type="submit" disabled={busy} className="btn btn-primary">
              {busy ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </form>
      </Card>

      {stats && (stats.byType.length > 0 || stats.byTag.length > 0) && (
        <Card title="Vault summary">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
            {stats.byType.map((t) => (
              <span key={t.refType} className="tnum text-fg-muted">
                {titleCase(t.refType)}: <span className="text-fg">{t.count}</span> ({kb(t.bytes)})
              </span>
            ))}
          </div>
          {stats.byTag.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {stats.byTag.map((t) => (
                <button key={t.tag} onClick={() => setSearch(t.tag)}
                        className="badge border-line-strong text-fg-muted hover:border-accent hover:text-accent">
                  {t.tag} · {t.count}
                </button>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11px] text-fg-faint">
            Counts come from MongoDB aggregation pipelines; the tag rollup uses{' '}
            <span className="tnum">$unwind</span> to count each tag in the array independently.
          </p>
        </Card>
      )}

      <Card
        title={`Documents (${docs.length})`}
        action={
          <div className="flex gap-2">
            <select value={refType} onChange={(e) => setRefType(e.target.value)}
                    className="select w-auto py-0.5 text-xs normal-case">
              <option value="all">All</option>
              <option value="loan">Loan</option>
              <option value="asset">Asset</option>
              <option value="general">General</option>
            </select>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
                   placeholder="Search title or tag" className="input w-44 py-0.5 text-xs" />
          </div>
        }
      >
        {docs.length === 0 ? (
          <Empty>No documents yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th><th>Attached to</th><th>Tags</th>
                  <th className="text-right">Size</th><th>Uploaded</th><th />
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d._id}>
                    <td>
                      <a href={d.fileUrl} target="_blank" rel="noopener noreferrer"
                         className="hover:text-accent">{d.title}</a>
                      <div className="text-[11px] text-fg-faint">{d.originalName}</div>
                    </td>
                    <td><Badge value={d.refType} /></td>
                    <td className="text-xs text-fg-muted">{d.tags.join(', ') || '—'}</td>
                    <td className="tnum text-right text-xs">{kb(d.sizeBytes)}</td>
                    <td className="tnum text-xs text-fg-muted">{formatDate(d.uploadedAt)}</td>
                    <td className="text-right">
                      <button onClick={() => remove(d._id)} className="btn btn-danger px-2 py-0.5 text-xs">
                        Del
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

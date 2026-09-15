'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Card, Empty, ErrorNote } from '@/components/ui';
import { formatINR, formatDate, formatPct, titleCase } from '@/lib/format';
import { ASSET_TYPES, DEFAULT_LIQUIDITY } from '@/lib/validation/schemas';

interface Asset {
  id: number; name: string; assetType: string; purchaseValue: number; currentValue: number;
  purchaseDate: string; valuationDate: string; notes: string | null; gain: number; gainPct: number;
  liquidity: 'liquid' | 'illiquid';
}

const today = () => new Date().toISOString().slice(0, 10);

export function AssetsView({ initial }: { initial: Asset[] }) {
  const router = useRouter();
  const [assets, setAssets] = useState(initial);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const total = assets.reduce((s, a) => s + a.currentValue, 0);
  const invested = assets.reduce((s, a) => s + a.purchaseValue, 0);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const payload = Object.fromEntries(new FormData(e.currentTarget).entries());
    try {
      if (editing) {
        const { asset } = await api.put<{ asset: Asset }>(`/api/assets/${editing.id}`, payload);
        setAssets((prev) => prev.map((a) => (a.id === asset.id ? asset : a)));
      } else {
        const { asset } = await api.post<{ asset: Asset }>('/api/assets', payload);
        setAssets((prev) => [asset, ...prev]);
      }
      setShowForm(false);
      setEditing(null);
      router.refresh();   // re-pull the dashboard's net worth, which the trigger just moved
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the asset.');
    } finally {
      setPending(false);
    }
  }

  async function remove(id: number) {
    if (!confirm('Delete this asset? Its valuation history will be removed too.')) return;
    try {
      await api.del(`/api/assets/${id}`);
      setAssets((prev) => prev.filter((a) => a.id !== id));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the asset.');
    }
  }

  function openNew() { setEditing(null); setShowForm(true); setError(null); }
  function openEdit(a: Asset) { setEditing(a); setShowForm(true); setError(null); }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Assets</h1>
          <p className="tnum mt-0.5 text-xs text-fg-muted">
            {formatINR(total)} current · {formatINR(invested)} invested ·{' '}
            <span className={total - invested >= 0 ? 'text-positive' : 'text-negative'}>
              {total - invested >= 0 ? '+' : ''}{formatINR(total - invested)}
            </span>
          </p>
        </div>
        <button onClick={openNew} className="btn btn-primary">+ Add asset</button>
      </div>

      <ErrorNote message={error} />

      {showForm && (
        <Card title={editing ? `Edit — ${editing.name}` : 'New asset'}>
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2 lg:col-span-1">
              <label className="label" htmlFor="a-name">Name</label>
              <input id="a-name" name="name" required className="input" defaultValue={editing?.name}
                     placeholder="SBI Gold ETF" />
            </div>
            <div>
              <label className="label" htmlFor="a-type">Class</label>
              <select id="a-type" name="assetType" className="select" defaultValue={editing?.assetType ?? 'gold'}>
                {ASSET_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="a-pv">Purchase value (₹)</label>
              <input id="a-pv" name="purchaseValue" type="number" step="0.01" min="0" required
                     className="input tnum" defaultValue={editing?.purchaseValue} />
            </div>
            <div>
              <label className="label" htmlFor="a-cv">Current value (₹)</label>
              <input id="a-cv" name="currentValue" type="number" step="0.01" min="0" required
                     className="input tnum" defaultValue={editing?.currentValue} />
            </div>
            <div>
              <label className="label" htmlFor="a-pd">Purchase date</label>
              <input id="a-pd" name="purchaseDate" type="date" required className="input tnum"
                     defaultValue={editing?.purchaseDate ?? today()} />
            </div>
            <div>
              <label className="label" htmlFor="a-vd">Valuation date</label>
              <input id="a-vd" name="valuationDate" type="date" className="input tnum"
                     defaultValue={editing?.valuationDate ?? today()} />
            </div>
            <div>
              <label className="label" htmlFor="a-liq">Liquidity</label>
              <select id="a-liq" name="liquidity" className="select"
                      defaultValue={editing?.liquidity ?? DEFAULT_LIQUIDITY.gold}>
                <option value="liquid">Liquid — realisable in days</option>
                <option value="illiquid">Illiquid — locked or slow to sell</option>
              </select>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="label" htmlFor="a-notes">Notes</label>
              <input id="a-notes" name="notes" className="input" defaultValue={editing?.notes ?? ''} />
            </div>
            <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
              <button type="submit" disabled={pending} className="btn btn-primary">
                {pending ? 'Saving…' : editing ? 'Save changes' : 'Add asset'}
              </button>
              <button type="button" className="btn" onClick={() => { setShowForm(false); setEditing(null); }}>
                Cancel
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        {assets.length === 0 ? (
          <Empty>No assets yet. Add gold, property, EPF or an equity holding to start tracking net worth.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Asset</th><th>Class</th><th>Liquidity</th>
                  <th className="text-right">Invested</th><th className="text-right">Current</th>
                  <th className="text-right">Gain</th><th>Valued</th><th />
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.name}
                      {a.notes && <div className="text-[11px] text-fg-faint">{a.notes}</div>}
                    </td>
                    <td className="text-fg-muted">{titleCase(a.assetType)}</td>
                    <td>
                      <span className={`badge ${
                        a.liquidity === 'liquid' ? 'border-info text-info' : 'border-line-strong text-fg-faint'
                      }`}>{a.liquidity}</span>
                    </td>
                    <td className="tnum text-right text-fg-muted">{formatINR(a.purchaseValue, { decimals: false })}</td>
                    <td className="tnum text-right">{formatINR(a.currentValue, { decimals: false })}</td>
                    <td className={`tnum text-right ${a.gain >= 0 ? 'text-positive' : 'text-negative'}`}>
                      {a.gain >= 0 ? '+' : ''}{formatINR(a.gain, { decimals: false })}
                      <span className="ml-1 text-[11px] opacity-70">{formatPct(a.gainPct)}</span>
                    </td>
                    <td className="tnum text-xs text-fg-muted">{formatDate(a.valuationDate)}</td>
                    <td className="whitespace-nowrap text-right">
                      <button onClick={() => openEdit(a)} className="btn px-2 py-0.5 text-xs">Edit</button>
                      <button onClick={() => remove(a.id)} className="btn btn-danger ml-1 px-2 py-0.5 text-xs">Del</button>
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

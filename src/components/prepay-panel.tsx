'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Card, ErrorNote } from '@/components/ui';
import { formatINR, formatDate } from '@/lib/format';

interface Mode {
  mode: 'reduce_tenure' | 'reduce_emi'; installmentsLeft: number; newEmi: number;
  totalInterest: number; interestSaved: number; monthsSaved: number; newEndDate: string | null;
}
interface Sim {
  outstanding: number;
  current: { installmentsLeft: number; emi: number; totalInterest: number; endDate: string | null };
  reduceTenure: Mode;
  reduceEmi: Mode;
}
interface AssetOption { id: number; name: string; currentValue: number; liquidity: string }

export function PrepayPanel({ loanId, outstanding, assets }: {
  loanId: number; outstanding: number; assets: AssetOption[];
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(Math.round(Math.min(outstanding, 200000))));
  const [sim, setSim] = useState<Sim | null>(null);
  const [fromAsset, setFromAsset] = useState(String(assets.find((a) => a.liquidity === 'liquid')?.id ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function simulate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setDone(null);
    try {
      const res = await api.post<{ simulation: Sim }>(`/api/loans/${loanId}/prepay/simulate`, { amount });
      setSim(res.simulation);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Simulation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function apply(mode: Mode['mode']) {
    const src = assets.find((a) => String(a.id) === fromAsset);
    const msg = `Prepay ${formatINR(Number(amount))}${src ? ` from ${src.name}` : ''}? `
      + 'Unpaid installments will be rescheduled. This cannot be undone.';
    if (!confirm(msg)) return;
    setBusy(true); setError(null);
    try {
      const res = await api.post<{ interestSaved: number }>(`/api/loans/${loanId}/prepay`, {
        amount, mode, fromAssetId: fromAsset ? Number(fromAsset) : null,
      });
      setDone(`Prepayment recorded. Interest saved: ${formatINR(res.interestSaved)}.`);
      setSim(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Prepayment failed — nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  const ModeCard = ({ m, title, blurb }: { m: Mode; title: string; blurb: string }) => (
    <div className="rounded-lg border p-3">
      <div className="text-sm font-medium">{title}</div>
      <div className="text-[11px] text-fg-faint">{blurb}</div>
      <dl className="tnum mt-3 grid grid-cols-2 gap-y-1.5 text-xs">
        <dt className="text-fg-muted">Interest saved</dt>
        <dd className="text-right font-semibold text-positive">{formatINR(m.interestSaved, { decimals: false })}</dd>
        <dt className="text-fg-muted">New EMI</dt>
        <dd className="text-right">{formatINR(m.newEmi)}</dd>
        <dt className="text-fg-muted">Installments left</dt>
        <dd className="text-right">{m.installmentsLeft}{m.monthsSaved > 0 && <span className="text-positive"> (−{m.monthsSaved})</span>}</dd>
        <dt className="text-fg-muted">Loan ends</dt>
        <dd className="text-right">{formatDate(m.newEndDate)}</dd>
      </dl>
      <button onClick={() => apply(m.mode)} disabled={busy} className="btn mt-3 w-full text-xs">
        Apply this option
      </button>
    </div>
  );

  return (
    <Card title="Prepayment simulator">
      <ErrorNote message={error} />
      {done && <p className="mb-3 text-sm text-positive">{done}</p>}

      <form onSubmit={simulate} className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="pp-amt">Lump sum (₹)</label>
          <input id="pp-amt" type="number" min="1" max={outstanding} step="any" value={amount}
                 onChange={(e) => setAmount(e.target.value)} className="input tnum" required />
          <div className="tnum mt-1 text-[11px] text-fg-faint">Outstanding {formatINR(outstanding)}</div>
        </div>
        <div>
          <label className="label" htmlFor="pp-src">Paid from</label>
          <select id="pp-src" value={fromAsset} onChange={(e) => setFromAsset(e.target.value)} className="select">
            <option value="">Outside WealthWise (income, gift…)</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {formatINR(a.currentValue, { compact: true })}
              </option>
            ))}
          </select>
          <div className="mt-1 text-[11px] text-fg-faint">The asset is debited in the same transaction.</div>
        </div>
        <div className="flex items-start pt-5">
          <button type="submit" disabled={busy} className="btn btn-primary w-full">
            {busy && !sim ? 'Calculating…' : 'Simulate'}
          </button>
        </div>
      </form>

      {sim && (
        <div className="mt-4 space-y-3">
          <p className="tnum text-xs text-fg-muted">
            Today: {sim.current.installmentsLeft} installments of {formatINR(sim.current.emi)} left,{' '}
            {formatINR(sim.current.totalInterest, { decimals: false })} interest still to pay, ending{' '}
            {formatDate(sim.current.endDate)}.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <ModeCard m={sim.reduceTenure} title="Keep the EMI, finish sooner"
                      blurb="Usually saves the most interest." />
            <ModeCard m={sim.reduceEmi} title="Keep the end date, lower the EMI"
                      blurb="Frees up monthly cash flow." />
          </div>
          <p className="text-[11px] text-fg-faint">
            Simulated by <span className="tnum">fn_simulate_prepayment</span> without changing anything. Applying runs
            <span className="tnum"> CALL sp_apply_prepayment</span>: one transaction that locks the loan, debits the
            source asset, rebuilds the unpaid schedule and records the payment. Net worth does not move — the
            liability and the asset fall by the same amount.
          </p>
        </div>
      )}
    </Card>
  );
}

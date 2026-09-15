'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Card, Empty, ErrorNote, Badge, Progress } from '@/components/ui';
import { formatINR, formatDate, formatPct, titleCase } from '@/lib/format';
import { LOAN_TYPES } from '@/lib/validation/schemas';

interface Loan {
  id: number; loanType: string; lender: string; principal: number; interestRate: number;
  interestType: 'fixed' | 'floating'; tenureMonths: number; startDate: string; status: string;
  emiAmount: number; outstanding: number; paidCount: number; progressPct: number;
  nextDueDate: string | null;
}

export function LoansView({ initial }: { initial: Loan[] }) {
  const router = useRouter();
  const [loans, setLoans] = useState(initial);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const active = loans.filter((l) => l.status === 'active');
  const outstanding = active.reduce((s, l) => s + l.outstanding, 0);
  const monthlyEmi = active.reduce((s, l) => s + l.emiAmount, 0);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const payload = Object.fromEntries(new FormData(e.currentTarget).entries());
    try {
      // The API generates the full EMI schedule in the same transaction.
      const { loan } = await api.post<{ loan: Loan }>('/api/loans', payload);
      setLoans((prev) => [loan, ...prev]);
      setShowForm(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the loan.');
    } finally {
      setPending(false);
    }
  }

  async function remove(id: number) {
    if (!confirm('Delete this loan and its entire EMI schedule?')) return;
    try {
      await api.del(`/api/loans/${id}`);
      setLoans((prev) => prev.filter((l) => l.id !== id));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the loan.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Loans</h1>
          <p className="tnum mt-0.5 text-xs text-fg-muted">
            {active.length} active · {formatINR(outstanding)} outstanding · {formatINR(monthlyEmi)}/month
          </p>
        </div>
        <button onClick={() => { setShowForm((s) => !s); setError(null); }} className="btn btn-primary">
          + Add loan
        </button>
      </div>

      <ErrorNote message={error} />

      {showForm && (
        <Card title="New loan">
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label" htmlFor="l-lender">Lender</label>
              <input id="l-lender" name="lender" required className="input" placeholder="HDFC Bank" />
            </div>
            <div>
              <label className="label" htmlFor="l-type">Loan type</label>
              <select id="l-type" name="loanType" className="select" defaultValue="home">
                {LOAN_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="l-principal">Principal (₹)</label>
              <input id="l-principal" name="principal" type="number" step="0.01" min="1" required className="input tnum" />
            </div>
            <div>
              <label className="label" htmlFor="l-rate">Interest rate (% p.a.)</label>
              <input id="l-rate" name="interestRate" type="number" step="0.01" min="0.01" max="60" required className="input tnum" />
            </div>
            <div>
              <label className="label" htmlFor="l-itype">Rate type</label>
              <select id="l-itype" name="interestType" className="select" defaultValue="fixed">
                <option value="fixed">Fixed</option>
                <option value="floating">Floating</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="l-tenure">Tenure (months)</label>
              <input id="l-tenure" name="tenureMonths" type="number" min="1" max="480" required className="input tnum" />
            </div>
            <div>
              <label className="label" htmlFor="l-start">Start date</label>
              <input id="l-start" name="startDate" type="date" required className="input tnum"
                     defaultValue={new Date().toISOString().slice(0, 10)} />
            </div>
            <div className="flex items-end gap-2">
              <button type="submit" disabled={pending} className="btn btn-primary">
                {pending ? 'Generating schedule…' : 'Create loan'}
              </button>
              <button type="button" className="btn" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
            <p className="text-xs text-fg-faint sm:col-span-2 lg:col-span-4">
              The full reducing-balance EMI schedule is generated in Postgres
              (<span className="tnum">fn_generate_emi_schedule</span>) inside the same transaction as the loan.
            </p>
          </form>
        </Card>
      )}

      {loans.length === 0 ? (
        <Card><Empty>No loans recorded yet.</Empty></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {loans.map((l) => (
            <Card key={l.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Link href={`/loans/${l.id}`} className="font-medium hover:text-accent">{l.lender}</Link>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge value={l.status} />
                    <Badge value={l.interestType} />
                    <span className="text-xs text-fg-muted">{titleCase(l.loanType)}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="tnum text-lg font-semibold">{formatINR(l.emiAmount)}</div>
                  <div className="text-[11px] text-fg-faint">per month</div>
                </div>
              </div>

              <dl className="tnum mt-3 grid grid-cols-3 gap-2 text-xs">
                <div><dt className="text-fg-faint">Principal</dt><dd>{formatINR(l.principal, { compact: true })}</dd></div>
                <div><dt className="text-fg-faint">Rate</dt><dd>{l.interestRate.toFixed(2)}%</dd></div>
                <div><dt className="text-fg-faint">Tenure</dt><dd>{l.tenureMonths} mo</dd></div>
              </dl>

              <div className="mt-3"><Progress pct={l.progressPct} tone={l.status === 'closed' ? 'positive' : 'accent'} /></div>
              <div className="mt-1 flex justify-between text-[11px] text-fg-faint">
                <span className="tnum">{l.paidCount}/{l.tenureMonths} paid · {formatPct(l.progressPct)}</span>
                <span className="tnum">{formatINR(l.outstanding, { compact: true })} outstanding</span>
              </div>

              <div className="mt-3 flex items-center justify-between border-t pt-2">
                <span className="tnum text-xs text-fg-muted">Next due {formatDate(l.nextDueDate)}</span>
                <div>
                  <Link href={`/loans/${l.id}`} className="btn px-2 py-0.5 text-xs">Schedule</Link>
                  <button onClick={() => remove(l.id)} className="btn btn-danger ml-1 px-2 py-0.5 text-xs">Del</button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Card, Badge, Progress, ErrorNote, Stat } from '@/components/ui';
import { formatINR, formatDate, formatPct, titleCase } from '@/lib/format';

interface Installment {
  id: number; installmentNo: number; dueDate: string; emiAmount: number;
  principalComponent: number; interestComponent: number; closingBalance: number;
  status: string; paidDate: string | null;
}
interface Loan {
  id: number; lender: string; loanType: string; principal: number; interestRate: number;
  interestType: string; tenureMonths: number; startDate: string; status: string;
  emiAmount: number; outstanding: number; paidCount: number; progressPct: number;
}

export function ScheduleView({ loan, schedule }: { loan: Loan; schedule: Installment[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(schedule);
  const [error, setError] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const totalInterest = rows.reduce((s, r) => s + r.interestComponent, 0);
  const paidInterest = rows.filter((r) => r.status === 'paid').reduce((s, r) => s + r.interestComponent, 0);
  const nextUnpaid = rows.find((r) => r.status !== 'paid');

  // Long schedules (a 240-month home loan) are collapsed to a useful window
  // around the next due installment rather than rendering 240 rows by default.
  const visible = showAll
    ? rows
    : rows.filter((r) => !nextUnpaid || Math.abs(r.installmentNo - nextUnpaid.installmentNo) <= 6);

  async function pay(id: number) {
    setPayingId(id);
    setError(null);
    try {
      await api.post(`/api/emi/${id}/pay`);
      setRows((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, status: 'paid', paidDate: new Date().toISOString().slice(0, 10) } : r,
        ),
      );
      router.refresh();   // net worth moved (trigger) and a ledger entry was written
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record the payment.');
    } finally {
      setPayingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <Link href="/loans" className="text-xs text-fg-faint hover:text-accent">← Loans</Link>
          <h1 className="mt-0.5 text-xl font-semibold">
            {loan.lender}{' '}
            <span className="text-sm font-normal text-fg-muted">{titleCase(loan.loanType)}</span>
          </h1>
          <div className="mt-1 flex gap-1.5">
            <Badge value={loan.status} />
            <Badge value={loan.interestType} />
            <span className="tnum text-xs text-fg-muted">
              {loan.interestRate.toFixed(2)}% · {loan.tenureMonths} months · from {formatDate(loan.startDate)}
            </span>
          </div>
        </div>
      </div>

      <ErrorNote message={error} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Monthly EMI" value={loan.emiAmount} />
        <Stat label="Outstanding" value={loan.outstanding} compact />
        <Stat label="Total interest" value={totalInterest} compact
              sub={`${formatINR(paidInterest, { compact: true })} paid so far`} />
        <Stat label="Total repayment" value={loan.principal + totalInterest} compact
              sub={`on ${formatINR(loan.principal, { compact: true })} borrowed`} />
      </div>

      <Card>
        <Progress pct={loan.progressPct} tone={loan.status === 'closed' ? 'positive' : 'accent'} />
        <div className="mt-1.5 flex justify-between text-xs text-fg-muted">
          <span className="tnum">{loan.paidCount} of {loan.tenureMonths} installments paid</span>
          <span className="tnum">{formatPct(loan.progressPct)} of principal repaid</span>
        </div>
      </Card>

      <Card
        title="Amortisation schedule"
        action={
          <button onClick={() => setShowAll((s) => !s)} className="text-xs text-accent">
            {showAll ? 'Show nearby only' : `Show all ${rows.length}`}
          </button>
        }
      >
        <div className="max-h-[32rem] overflow-auto">
          <table className="table">
            <thead className="sticky top-0 bg-bg-raised">
              <tr>
                <th className="text-right">#</th><th>Due</th>
                <th className="text-right">EMI</th><th className="text-right">Principal</th>
                <th className="text-right">Interest</th><th className="text-right">Balance</th>
                <th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const overdue = r.status !== 'paid' && new Date(r.dueDate) < new Date();
                return (
                  <tr key={r.id} className={r.id === nextUnpaid?.id ? 'bg-bg-soft' : ''}>
                    <td className="tnum text-right text-fg-faint">{r.installmentNo}</td>
                    <td className="tnum text-xs">{formatDate(r.dueDate)}</td>
                    <td className="tnum text-right">{formatINR(r.emiAmount)}</td>
                    <td className="tnum text-right text-positive">{formatINR(r.principalComponent)}</td>
                    <td className="tnum text-right text-negative">{formatINR(r.interestComponent)}</td>
                    <td className="tnum text-right text-fg-muted">{formatINR(r.closingBalance, { decimals: false })}</td>
                    <td><Badge value={overdue ? 'overdue' : r.status} /></td>
                    <td className="text-right">
                      {r.status !== 'paid' && (
                        <button onClick={() => pay(r.id)} disabled={payingId === r.id}
                                className="btn px-2 py-0.5 text-xs">
                          {payingId === r.id ? '…' : 'Mark paid'}
                        </button>
                      )}
                      {r.paidDate && <span className="tnum text-[11px] text-fg-faint">{formatDate(r.paidDate)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-fg-faint">
          Marking an installment paid runs one transaction: the installment flips to paid, a{' '}
          <span className="tnum">loan</span> entry is written to the ledger, and the loan auto-closes when the
          last installment clears. The net worth snapshot refreshes via trigger.
        </p>
      </Card>
    </div>
  );
}

import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { currentNetWorth, refreshNetWorth } from '@/lib/db/networth';
import { listAssets, assetAllocation } from '@/lib/db/assets';
import { listLoans } from '@/lib/db/loans';
import { monthlySummary } from '@/lib/db/transactions';
import { Card, Stat, Progress, Empty } from '@/components/ui';
import { formatINR, formatPct, titleCase, formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requireUser();

  // A fresh account has no snapshot until a trigger fires; seed one on first view.
  if (!(await currentNetWorth(user.id))) await refreshNetWorth(user.id);

  const monthStart = new Date().toISOString().slice(0, 8) + '01';
  const [netWorth, assets, allocation, loans, summary] = await Promise.all([
    currentNetWorth(user.id),
    listAssets(user.id),
    assetAllocation(user.id),
    listLoans(user.id),
    monthlySummary(user.id, monthStart),
  ]);

  const income = summary.totals.find((t) => t.txnType === 'income')?.total ?? 0;
  const expense = summary.totals.find((t) => t.txnType === 'expense')?.total ?? 0;
  const activeLoans = loans.filter((l) => l.status === 'active');
  const monthLabel = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Overview</h1>
        <span className="text-xs text-fg-faint">
          Snapshot as of {formatDate(netWorth?.snapshotDate)}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Net worth"       value={netWorth?.netWorth ?? 0} signed compact
              sub={`${assets.length} assets · ${activeLoans.length} active loans`} />
        <Stat label="Total assets"    value={netWorth?.totalAssets ?? 0} compact />
        <Stat label="Outstanding debt" value={netWorth?.totalLiabilities ?? 0} compact />
        <Stat label={`Net flow · ${monthLabel}`} value={income - expense} signed
              sub={`In ${formatINR(income, { compact: true })} · Out ${formatINR(expense, { compact: true })}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Asset allocation" action={<Link href="/assets" className="text-xs text-accent">Manage →</Link>}>
          {allocation.length === 0 ? (
            <Empty>No assets recorded yet.</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Class</th><th className="text-right">Holdings</th><th className="text-right">Value</th><th className="text-right">Share</th></tr>
              </thead>
              <tbody>
                {allocation.map((a) => (
                  <tr key={a.assetType}>
                    <td>{titleCase(a.assetType)}</td>
                    <td className="tnum text-right text-fg-muted">{a.holdings}</td>
                    <td className="tnum text-right">{formatINR(a.total, { decimals: false })}</td>
                    <td className="tnum text-right text-fg-muted">{formatPct(a.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Loan payoff progress" action={<Link href="/loans" className="text-xs text-accent">Manage →</Link>}>
          {activeLoans.length === 0 ? (
            <Empty>No active loans.</Empty>
          ) : (
            <ul className="space-y-3">
              {activeLoans.map((l) => (
                <li key={l.id}>
                  <div className="flex items-baseline justify-between text-sm">
                    <Link href={`/loans/${l.id}`} className="hover:text-accent">
                      {l.lender} <span className="text-xs text-fg-faint">· {titleCase(l.loanType)}</span>
                    </Link>
                    <span className="tnum text-xs text-fg-muted">
                      {formatINR(l.outstanding, { compact: true })} left
                    </span>
                  </div>
                  <div className="mt-1.5"><Progress pct={l.progressPct} /></div>
                  <div className="mt-1 flex justify-between text-[11px] text-fg-faint">
                    <span className="tnum">{l.paidCount}/{l.tenureMonths} paid · {formatPct(l.progressPct)}</span>
                    <span className="tnum">Next due {formatDate(l.nextDueDate)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={`Top expense categories · ${monthLabel}`}
            action={<Link href="/transactions" className="text-xs text-accent">Ledger →</Link>}>
        {summary.byCategory.length === 0 ? (
          <Empty>No expenses recorded this month.</Empty>
        ) : (
          <table className="table">
            <thead><tr><th>Category</th><th className="text-right">Spent</th><th className="text-right">Share</th></tr></thead>
            <tbody>
              {summary.byCategory.map((c) => (
                <tr key={c.category}>
                  <td>{titleCase(c.category)}</td>
                  <td className="tnum text-right text-negative">{formatINR(c.total)}</td>
                  <td className="tnum text-right text-fg-muted">{formatPct(c.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

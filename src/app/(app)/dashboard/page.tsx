import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { currentNetWorth, netWorthTrend, refreshNetWorth } from '@/lib/db/networth';
import {
  netWorthSummary, upcomingDues, markOverdue, allocation,
  loanPayoffProgress, monthlyCashflow, recurringExpenses,
} from '@/lib/db/views';
import { Card, Stat, Progress, Empty } from '@/components/ui';
import { NetWorthTrend } from '@/components/charts/net-worth-trend';
import { AllocationBar } from '@/components/charts/allocation-bar';
import { CashflowBars } from '@/components/charts/cashflow-bars';
import { UpcomingDues } from '@/components/upcoming-dues';
import { formatINR, formatPct, titleCase, formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requireUser();

  // Two writes before reading: seed a snapshot for a brand-new account, and
  // flip any installment whose due date has quietly passed.
  if (!(await currentNetWorth(user.id))) await refreshNetWorth(user.id);
  await markOverdue(user.id);

  // Independent reads, so they run concurrently on separate pool connections.
  const [summary, trend, dues, mix, loans, cashflow, recurring] = await Promise.all([
    netWorthSummary(user.id),
    netWorthTrend(user.id, 400),
    upcomingDues(user.id, 45, 10),
    allocation(user.id),
    loanPayoffProgress(user.id),
    monthlyCashflow(user.id, 12),
    recurringExpenses(user.id, 6),
  ]);

  const activeLoans = loans.filter((l) => l.status === 'active');
  const thisMonth = cashflow.at(-1);
  const avgExpense = cashflow.length
    ? cashflow.reduce((s, m) => s + m.expense, 0) / cashflow.length
    : 0;
  // Emergency-fund coverage: how many months of typical spending the liquid
  // assets would cover. This is why 005 added the `liquidity` column.
  const runwayMonths = avgExpense > 0 ? summary.liquidAssets / avgExpense : 0;
  const committed = recurring.reduce((s, r) => s + r.monthlyRunRate, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Overview</h1>
        <span className="text-xs text-fg-faint">Live figures · {formatDate(new Date().toISOString())}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Net worth" value={summary.netWorth} signed compact
              sub={`${summary.assetCount} assets · ${summary.activeLoanCount} active loans`} />
        <Stat label="Total assets" value={summary.totalAssets} compact
              sub={`${formatINR(summary.liquidAssets, { compact: true })} liquid`} />
        <Stat label="Outstanding debt" value={summary.totalLiabilities} compact
              sub={summary.debtToAssetPct === null
                ? 'No assets to compare against'
                : `${formatPct(summary.debtToAssetPct)} of assets`} />
        <Stat label="Monthly EMI burden" value={summary.monthlyEmiBurden}
              sub={thisMonth ? `${formatINR(thisMonth.income, { compact: true })} income this month` : undefined} />
      </div>

      <Card title="Net worth trend">
        <NetWorthTrend data={trend} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Asset allocation"
              action={<Link href="/assets" className="text-xs text-accent">Manage →</Link>}>
          <AllocationBar data={mix} />
          {/* The table view the palette's secondary-encoding rule requires:
              every number is readable without relying on colour at all. */}
          {mix.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Class</th><th className="text-right">Held</th>
                    <th className="text-right">Invested</th><th className="text-right">Value</th>
                    <th className="text-right">Gain</th><th className="text-right">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {mix.map((a) => (
                    <tr key={a.assetType}>
                      <td>{titleCase(a.assetType)}</td>
                      <td className="tnum text-right text-fg-muted">{a.holdings}</td>
                      <td className="tnum text-right text-fg-muted">{formatINR(a.invested, { decimals: false })}</td>
                      <td className="tnum text-right">{formatINR(a.currentValue, { decimals: false })}</td>
                      <td className={`tnum whitespace-nowrap text-right ${a.unrealisedGain >= 0 ? 'text-positive' : 'text-negative'}`}>
                        {a.unrealisedGain >= 0 ? '+' : ''}{formatINR(a.unrealisedGain, { decimals: false })}
                        {a.gainPct !== null && <span className="ml-1 text-[11px] opacity-70">{formatPct(a.gainPct)}</span>}
                      </td>
                      <td className="tnum text-right text-fg-muted">{formatPct(a.allocationPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Loan payoff progress"
              action={<Link href="/loans" className="text-xs text-accent">Manage →</Link>}>
          {activeLoans.length === 0 ? (
            <Empty>No active loans.</Empty>
          ) : (
            <ul className="space-y-4">
              {activeLoans.map((l) => (
                <li key={l.loanId}>
                  <div className="flex items-baseline justify-between text-sm">
                    <Link href={`/loans/${l.loanId}`} className="hover:text-accent">
                      {l.lender} <span className="text-xs text-fg-faint">· {titleCase(l.loanType)}</span>
                    </Link>
                    <span className="tnum text-xs text-fg-muted">
                      {formatINR(l.outstanding, { compact: true })} left
                    </span>
                  </div>
                  {/* Both progress measures, because they diverge: month 86 of
                      240 is 36% of the tenure but only 19% of the principal. */}
                  <div className="mt-1.5"><Progress pct={l.principalProgressPct} /></div>
                  <div className="tnum mt-1 flex justify-between text-[11px] text-fg-faint">
                    <span>{formatPct(l.principalProgressPct)} of principal repaid</span>
                    <span>{l.paidInstallments}/{l.totalInstallments} EMIs ({formatPct(l.tenureProgressPct)} of tenure)</span>
                  </div>
                  {l.overdueInstallments > 0 && (
                    <div className="tnum mt-1 text-[11px] text-negative">
                      {l.overdueInstallments} overdue installment{l.overdueInstallments === 1 ? '' : 's'}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Upcoming EMI dues · next 45 days"
            action={<Link href="/loans" className="text-xs text-accent">All loans →</Link>}>
        <UpcomingDues dues={dues} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Income vs expense · last 12 months">
          <CashflowBars data={cashflow} />
        </Card>

        <Card title="Recurring commitments"
              action={<Link href="/transactions" className="text-xs text-accent">Ledger →</Link>}>
          {recurring.length === 0 ? (
            <Empty>Not enough history yet — a category needs 3 months to count as recurring.</Empty>
          ) : (
            <>
              <div className="tnum mb-2 text-lg font-semibold">
                {formatINR(committed, { compact: true })}
                <span className="ml-1.5 text-xs font-normal text-fg-muted">per month, typical</span>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Category</th><th className="text-right">Months</th>
                    <th className="text-right">Run rate</th><th className="text-right">Range</th>
                  </tr>
                </thead>
                <tbody>
                  {recurring.map((r) => (
                    <tr key={r.category}>
                      <td>{titleCase(r.category)}</td>
                      <td className="tnum text-right text-fg-muted">{r.monthsSeen}</td>
                      <td className="tnum text-right">{formatINR(r.monthlyRunRate)}</td>
                      <td className="tnum text-right text-[11px] text-fg-faint">
                        {formatINR(r.minAmount, { decimals: false })}–{formatINR(r.maxAmount, { decimals: false })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-fg-faint">
                Categories appearing in 3+ distinct months of the last year, filtered in SQL with{' '}
                <span className="tnum">HAVING COUNT(DISTINCT month) &gt;= 3</span>.
              </p>
            </>
          )}
        </Card>
      </div>

      {runwayMonths > 0 && (
        <Card title="Emergency fund coverage">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={`tnum text-2xl font-semibold ${
              runwayMonths >= 6 ? 'text-positive' : runwayMonths >= 3 ? 'text-warning' : 'text-negative'
            }`}>
              {runwayMonths.toFixed(1)} months
            </span>
            <span className="text-xs text-fg-muted">
              {formatINR(summary.liquidAssets, { compact: true })} in liquid assets against{' '}
              {formatINR(avgExpense)} average monthly spending
            </span>
          </div>
          <div className="mt-2"><Progress pct={(runwayMonths / 12) * 100}
                tone={runwayMonths >= 6 ? 'positive' : 'accent'} /></div>
          <p className="mt-1 text-[11px] text-fg-faint">
            Six months is the usual guideline. Liquidity comes from the{' '}
            <span className="tnum">assets.liquidity</span> column added in migration 005.
          </p>
        </Card>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/client';
import { Card, Empty, ErrorNote, Stat } from '@/components/ui';
import { CashflowBars } from '@/components/charts/cashflow-bars';
import { formatINR, formatPct, titleCase } from '@/lib/format';

interface Report {
  startYear: number; label: string;
  summary: { income: number; expense: number; loanOutflow: number; txnCount: number; savingsRatePct: number | null } | null;
  categories: { category: string; txnCount: number; total: number; sharePct: number }[];
  loans: { lender: string; loanType: string; emisPaid: number; totalPaid: number; principalRepaid: number; interestPaid: number }[];
  tax: { sec24b: number; sec80c: number; sec80e: number } | null;
  monthly: { month: string; income: number; expense: number }[];
}

export function ReportsView() {
  const [years, setYears] = useState<{ startYear: number; label: string }[]>([]);
  const [fy, setFy] = useState<number | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const qs = fy ? `?fy=${fy}` : '';
    api.get<{ years: typeof years; report: Report }>(`/api/reports/fy${qs}`)
      .then((r) => { setYears(r.years); setReport(r.report); if (!fy) setFy(r.report.startYear); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the report.'));
  }, [fy]);

  const s = report?.summary;
  const totalInterest = report?.loans.reduce((a, l) => a + l.interestPaid, 0) ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Reports</h1>
          <p className="mt-0.5 text-xs text-fg-muted">Indian financial year, 1 April to 31 March.</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="label" htmlFor="fy">Financial year</label>
            <select id="fy" value={fy ?? ''} onChange={(e) => setFy(Number(e.target.value))} className="select w-40">
              {years.map((y) => <option key={y.startYear} value={y.startYear}>{y.label}</option>)}
            </select>
          </div>
          {/* A plain link, not fetch(): the browser handles the PDF download
              natively, using the Content-Disposition header the route sets. */}
          <a href="/api/reports/statement" className="btn btn-primary">Download net worth statement (PDF)</a>
        </div>
      </div>

      <ErrorNote message={error} />

      {report && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={`Income · ${report.label}`} value={s?.income ?? 0} compact />
            <Stat label="Expenses" value={s?.expense ?? 0} compact />
            <Stat label="Saved" value={(s?.income ?? 0) - (s?.expense ?? 0)} signed compact
                  sub={s?.savingsRatePct != null ? `${s.savingsRatePct}% savings rate` : undefined} />
            <Stat label="Loan interest paid" value={totalInterest} compact
                  sub={`${report.loans.reduce((a, l) => a + l.emisPaid, 0)} EMIs paid`} />
          </div>

          <Card title={`Month by month · ${report.label}`}>
            <CashflowBars data={report.monthly.map((m) => ({ ...m, net: m.income - m.expense }))} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Where the money went">
              {report.categories.length === 0 ? <Empty>No expenses this year.</Empty> : (
                <table className="table">
                  <thead><tr><th>Category</th><th className="text-right">Entries</th><th className="text-right">Spent</th><th className="text-right">Share</th></tr></thead>
                  <tbody>
                    {report.categories.map((c) => (
                      <tr key={c.category}>
                        <td>{titleCase(c.category)}</td>
                        <td className="tnum text-right text-fg-muted">{c.txnCount}</td>
                        <td className="tnum text-right">{formatINR(c.total, { decimals: false })}</td>
                        <td className="tnum text-right text-fg-muted">{formatPct(c.sharePct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <div className="space-y-4">
              <Card title="Loan repayments">
                {report.loans.length === 0 ? <Empty>No EMIs paid this year.</Empty> : (
                  <table className="table">
                    <thead><tr><th>Lender</th><th className="text-right">EMIs</th><th className="text-right">Principal</th><th className="text-right">Interest</th></tr></thead>
                    <tbody>
                      {report.loans.map((l) => (
                        <tr key={l.lender + l.loanType}>
                          <td>{l.lender}<span className="ml-1.5 text-[11px] text-fg-faint">{titleCase(l.loanType)}</span></td>
                          <td className="tnum text-right text-fg-muted">{l.emisPaid}</td>
                          <td className="tnum text-right text-positive">{formatINR(l.principalRepaid, { decimals: false })}</td>
                          <td className="tnum text-right text-negative">{formatINR(l.interestPaid, { decimals: false })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              {report.tax && (report.tax.sec24b + report.tax.sec80c + report.tax.sec80e > 0) && (
                <Card title="Indicative tax deductions (old regime)">
                  <dl className="tnum grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
                    <dt>Sec 24(b) — home loan interest <span className="text-[11px] text-fg-faint">cap ₹2,00,000</span></dt>
                    <dd className="text-right">{formatINR(report.tax.sec24b, { decimals: false })}</dd>
                    <dt>Sec 80C — home loan principal <span className="text-[11px] text-fg-faint">cap ₹1,50,000, shared</span></dt>
                    <dd className="text-right">{formatINR(report.tax.sec80c, { decimals: false })}</dd>
                    <dt>Sec 80E — education loan interest <span className="text-[11px] text-fg-faint">no cap</span></dt>
                    <dd className="text-right">{formatINR(report.tax.sec80e, { decimals: false })}</dd>
                  </dl>
                  <p className="mt-2 text-[11px] text-fg-faint">
                    From the repayment schedule, by the date each EMI was paid. The 80C limit is shared with EPF, PPF,
                    ELSS and insurance, and none of these apply under the new regime. Not tax advice.
                  </p>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/client';
import { Card, Empty, ErrorNote, Progress, Badge } from '@/components/ui';
import { ScoreTrend } from '@/components/charts/score-trend';
import { ProjectionChart } from '@/components/charts/projection-chart';
import { formatINR, titleCase } from '@/lib/format';
import { LOAN_TYPES } from '@/lib/validation/schemas';

interface Factor { key: string; weight: number; value: number }
interface Score {
  current: { score: number; computedDate: string; factors: Factor[];
             inputs: Record<string, number | null>; disclaimer: string };
  history: { date: string; score: number }[];
}
interface Rec {
  productId: number; lender: string; productName: string; eligible: boolean; reasons: string[];
  estimatedRate: number; tenureMonths: number; estimatedEmi: number; processingFee: number;
  totalCost: number; foirPct: number | null; matchScore: number;
}
interface Proj { monthOffset: number; month: string; netWorth: number; scenarioNetWorth: number }
interface LoanOption { id: number; lender: string; loanType: string; outstanding: number }

const FACTOR_LABEL: Record<string, string> = {
  payment_history: 'Payment history', debt_to_assets: 'Debt against assets',
  loan_mix: 'Number of active loans', history_length: 'Length of history', track_record: 'Loans closed cleanly',
};

function band(score: number): { label: string; tone: string } {
  if (score >= 750) return { label: 'Excellent', tone: 'text-positive' };
  if (score >= 700) return { label: 'Good', tone: 'text-info' };
  if (score >= 650) return { label: 'Fair', tone: 'text-warning' };
  return { label: 'Needs work', tone: 'text-negative' };
}

export function InsightsView({ score, loans }: { score: Score | null; loans: LoanOption[] }) {
  const [error, setError] = useState<string | null>(null);

  // -------------------------------------------------- recommendations
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [recBusy, setRecBusy] = useState(false);

  async function findProducts(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRecBusy(true); setError(null);
    try {
      const payload = Object.fromEntries(new FormData(e.currentTarget).entries());
      const res = await api.post<{ recommendations: Rec[] }>('/api/insights/recommend', payload);
      setRecs(res.recommendations);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not fetch recommendations.');
    } finally {
      setRecBusy(false);
    }
  }

  // ------------------------------------------------------- projection
  const [closeLoan, setCloseLoan] = useState<string>(loans[0] ? String(loans[0].id) : '');
  const [growth, setGrowth] = useState('8');
  const [years, setYears] = useState('5');
  const [proj, setProj] = useState<Proj[]>([]);

  const loadProjection = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ months: String(Number(years) * 12), growthPct: growth });
      if (closeLoan) qs.set('closeLoanId', closeLoan);
      const res = await api.get<{ projection: Proj[] }>(`/api/insights/projection?${qs}`);
      setProj(res.projection);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not project net worth.');
    }
  }, [closeLoan, growth, years]);

  useEffect(() => { void loadProjection(); }, [loadProjection]);

  const end = proj.at(-1);
  const chosen = loans.find((l) => String(l.id) === closeLoan);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Insights</h1>
        <p className="mt-0.5 text-xs text-fg-muted">
          Your repayment score, the loans you would qualify for, and what closing a loan early would do.
        </p>
      </div>

      <ErrorNote message={error} />

      {/* --------------------------------------------------------- score */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card title="WealthWise score" className="lg:col-span-2">
          {!score ? <Empty>No repayment history yet.</Empty> : (
            <>
              <div className="flex items-baseline gap-3">
                <span className={`tnum text-5xl font-semibold ${band(score.current.score).tone}`}>
                  {score.current.score}
                </span>
                <span className="text-sm text-fg-muted">/ 900 · {band(score.current.score).label}</span>
              </div>
              <ul className="mt-4 space-y-2.5">
                {score.current.factors.map((f) => (
                  <li key={f.key}>
                    <div className="flex justify-between text-xs">
                      <span>{FACTOR_LABEL[f.key] ?? titleCase(f.key)}</span>
                      <span className="tnum text-fg-faint">{Math.round(f.value * 100)}% · weight {Math.round(f.weight * 100)}%</span>
                    </div>
                    <div className="mt-1"><Progress pct={f.value * 100} tone={f.value >= 0.7 ? 'positive' : 'accent'} /></div>
                  </li>
                ))}
              </ul>
              <p className="tnum mt-3 text-[11px] text-fg-faint">
                {score.current.inputs.on_time ?? 0} of {score.current.inputs.installments_due ?? 0} EMIs on time ·{' '}
                {score.current.inputs.overdue ?? 0} overdue · {score.current.inputs.history_months ?? 0} months of history
              </p>
              <p className="mt-2 rounded-md border border-line px-2.5 py-1.5 text-[11px] text-fg-muted">
                {score.current.disclaimer} It is recomputed by database triggers whenever an EMI is paid or a
                loan changes.
              </p>
            </>
          )}
        </Card>

        <Card title="Score over the last year" className="lg:col-span-3">
          {score ? <ScoreTrend data={score.history} /> : <Empty>No history yet.</Empty>}
          <p className="mt-2 text-[11px] text-fg-faint">
            The shaded band is 750 and above. Each point is re-evaluated using only the data that existed on that date.
          </p>
        </Card>
      </div>

      {/* ------------------------------------------------ recommendations */}
      <Card title="Find a loan">
        <form onSubmit={findProducts} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="r-type">Loan type</label>
            <select id="r-type" name="loanType" className="select" defaultValue="home">
              {LOAN_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="r-amt">Amount (₹)</label>
            <input id="r-amt" name="amount" type="number" min="1000" step="1000" required
                   defaultValue={2500000} className="input tnum" />
          </div>
          <div>
            <label className="label" htmlFor="r-ten">Tenure (months)</label>
            <input id="r-ten" name="tenureMonths" type="number" min="1" max="480" required
                   defaultValue={240} className="input tnum" />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={recBusy} className="btn btn-primary w-full">
              {recBusy ? 'Matching…' : 'Compare lenders'}
            </button>
          </div>
        </form>

        {recs && (recs.length === 0 ? <Empty>No products of that type in the catalogue.</Empty> : (
          <div className="mt-4 overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Lender</th><th className="text-right">Est. rate</th><th className="text-right">EMI</th>
                  <th className="text-right">Fee</th><th className="text-right">Total cost</th>
                  <th className="text-right">FOIR</th><th className="text-right">Match</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recs.map((r) => (
                  <tr key={r.productId} className={r.eligible ? '' : 'opacity-60'}>
                    <td>
                      {r.lender}
                      <div className="text-[11px] text-fg-faint">{r.productName}</div>
                      {r.reasons.map((reason) => (
                        <div key={reason} className="text-[11px] text-warning">{reason}</div>
                      ))}
                    </td>
                    <td className="tnum text-right">{r.estimatedRate.toFixed(2)}%</td>
                    <td className="tnum text-right">{formatINR(r.estimatedEmi, { decimals: false })}</td>
                    <td className="tnum text-right text-fg-muted">{formatINR(r.processingFee, { decimals: false })}</td>
                    <td className="tnum text-right">{formatINR(r.totalCost, { compact: true })}</td>
                    <td className="tnum text-right text-fg-muted">{r.foirPct === null ? '—' : `${r.foirPct}%`}</td>
                    <td className="tnum text-right font-semibold">{r.matchScore.toFixed(0)}</td>
                    <td><Badge value={r.eligible ? 'eligible' : 'ineligible'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-fg-faint">
              Rates are estimated within each lender&apos;s published band from your score. FOIR is all your EMIs,
              including this one, as a share of average monthly income; lenders usually cap it near 50%. Ranked by
              <span className="tnum"> fn_recommend_loan_products</span>: 40% rate, 25% score headroom, 20% affordability,
              15% fee. Indicative only — no lender has been contacted.
            </p>
          </div>
        ))}
      </Card>

      {/* ----------------------------------------------------- projection */}
      <Card title="What if I closed a loan early?">
        {loans.length === 0 ? <Empty>No active loans to close.</Empty> : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="p-loan">Close this loan today</label>
                <select id="p-loan" value={closeLoan} onChange={(e) => setCloseLoan(e.target.value)} className="select">
                  {loans.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.lender} · {titleCase(l.loanType)} · {formatINR(l.outstanding, { compact: true })}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="p-g">Asset growth (% a year)</label>
                <input id="p-g" type="number" min="0" max="30" step="0.5" value={growth}
                       onChange={(e) => setGrowth(e.target.value)} className="input tnum" />
              </div>
              <div>
                <label className="label" htmlFor="p-y">Horizon (years)</label>
                <select id="p-y" value={years} onChange={(e) => setYears(e.target.value)} className="select">
                  {[3, 5, 10, 15, 20].map((y) => <option key={y} value={y}>{y} years</option>)}
                </select>
              </div>
            </div>

            {end && chosen && (
              <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <span className="text-xs text-fg-muted">In {years} years, net worth would be</span>
                <span className={`tnum text-2xl font-semibold ${end.scenarioNetWorth >= end.netWorth ? 'text-positive' : 'text-negative'}`}>
                  {end.scenarioNetWorth >= end.netWorth ? '+' : '−'}
                  {formatINR(Math.abs(end.scenarioNetWorth - end.netWorth), { compact: true })}
                </span>
                <span className="text-xs text-fg-muted">
                  compared with keeping the loan ({formatINR(end.netWorth, { compact: true })} →{' '}
                  {formatINR(end.scenarioNetWorth, { compact: true })})
                </span>
              </div>
            )}

            <div className="mt-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-faint">
                Net worth gained by closing it now, month by month
              </div>
              <ProjectionChart data={proj} scenarioLabel={chosen ? `Close ${chosen.lender} now` : 'Scenario'} />
            </div>
            <p className="mt-2 text-[11px] text-fg-faint">
              Assumes the outstanding balance is paid from assets today and the EMI you no longer owe is saved each
              month; both scenarios compound at the growth rate you set. At 0% growth the gap at the end equals the
              interest the loan would have charged. Computed in SQL by <span className="tnum">fn_project_net_worth</span>.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/client';
import { Card, Empty, ErrorNote, Badge } from '@/components/ui';
import { formatINR, formatDate, titleCase } from '@/lib/format';

interface Article {
  id: string; headline: string; source: string; category: string; tags: string[]; body: string;
  url: string | null; publishedAt: string; relatedRateType: string; rateChangeBps: number | null; isSample: boolean;
}
interface Impact {
  bps: number;
  loans: { loanId: number; lender: string; loanType: string; rate: number; newRate: number;
           outstanding: number; remaining: number; oldEmi: number; newEmi: number;
           emiChange: number; lifetimeChange: number }[];
  totalMonthlyChange: number;
  totalLifetimeChange: number;
}

export function NewsView() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [categories, setCategories] = useState<{ category: string; count: number }[]>([]);
  const [category, setCategory] = useState('all');
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [impact, setImpact] = useState<Record<string, Impact | null>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ articles: Article[]; categories: typeof categories; note: string | null }>(
      `/api/news?category=${category}`,
    ).then((r) => {
      setArticles(r.articles);
      if (category === 'all') setCategories(r.categories);
      setNote(r.note);
    }).catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load news.'));
  }, [category]);

  async function showImpact(a: Article) {
    if (open === a.id) { setOpen(null); return; }
    setOpen(a.id);
    if (a.id in impact) return;
    try {
      const r = await api.get<{ impact: Impact | null }>(`/api/news/${a.id}/impact`);
      setImpact((prev) => ({ ...prev, [a.id]: r.impact }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not compute the impact.');
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">News</h1>
        <p className="mt-0.5 text-xs text-fg-muted">
          Rate and banking news, with what each rate change would do to your floating-rate loans.
        </p>
      </div>

      <ErrorNote message={error} />
      {note && <p className="rounded-md border border-warning px-3 py-2 text-xs text-warning">{note}</p>}

      <div className="flex flex-wrap gap-1.5">
        {[{ category: 'all', count: categories.reduce((s, c) => s + c.count, 0) }, ...categories].map((c) => (
          <button key={c.category} onClick={() => setCategory(c.category)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    category === c.category ? 'border-accent text-accent' : 'border-line-strong text-fg-muted hover:text-fg'
                  }`}>
            {titleCase(c.category)} <span className="tnum opacity-70">{c.count}</span>
          </button>
        ))}
      </div>

      {articles.length === 0 ? <Card><Empty>No articles in this category.</Empty></Card> : (
        <div className="space-y-3">
          {articles.map((a) => {
            const imp = impact[a.id];
            return (
              <Card key={a.id}>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-fg-faint">
                  <Badge value={a.category} />
                  {a.isSample && <Badge value="sample" />}
                  <span>{a.source} · {formatDate(a.publishedAt)}</span>
                </div>
                <h2 className="mt-1.5 font-medium">
                  {a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent">{a.headline}</a> : a.headline}
                </h2>
                <p className="mt-1 text-sm text-fg-muted">{a.body}</p>

                {a.rateChangeBps !== null && (
                  <button onClick={() => showImpact(a)} className="btn mt-3 text-xs">
                    {open === a.id ? 'Hide' : 'How does this affect my loans?'}
                    <span className={`tnum ${a.rateChangeBps > 0 ? 'text-negative' : 'text-positive'}`}>
                      {a.rateChangeBps > 0 ? '+' : ''}{a.rateChangeBps} bps
                    </span>
                  </button>
                )}

                {open === a.id && (
                  <div className="mt-3 rounded-lg border bg-bg-soft p-3">
                    {imp === undefined ? <p className="text-xs text-fg-muted">Working it out…</p>
                      : !imp || imp.loans.length === 0 ? (
                        <p className="text-xs text-fg-muted">
                          You have no active floating-rate loans, so this change does not affect your EMIs.
                        </p>
                      ) : (
                        <>
                          <p className="text-sm">
                            Your EMIs would {imp.totalMonthlyChange > 0 ? 'rise' : 'fall'} by{' '}
                            <span className={`tnum font-semibold ${imp.totalMonthlyChange > 0 ? 'text-negative' : 'text-positive'}`}>
                              {formatINR(Math.abs(imp.totalMonthlyChange))} a month
                            </span>
                            , or about{' '}
                            <span className="tnum">{formatINR(Math.abs(imp.totalLifetimeChange), { compact: true })}</span>{' '}
                            over the remaining tenure.
                          </p>
                          <table className="table mt-2">
                            <thead><tr><th>Loan</th><th className="text-right">Rate</th><th className="text-right">EMI now</th><th className="text-right">EMI after</th><th className="text-right">Change</th></tr></thead>
                            <tbody>
                              {imp.loans.map((l) => (
                                <tr key={l.loanId}>
                                  <td>{l.lender}<span className="ml-1.5 text-[11px] text-fg-faint">{titleCase(l.loanType)} · {l.remaining} left</span></td>
                                  <td className="tnum text-right text-xs">{l.rate.toFixed(2)}% → {l.newRate.toFixed(2)}%</td>
                                  <td className="tnum text-right">{formatINR(l.oldEmi)}</td>
                                  <td className="tnum text-right">{formatINR(l.newEmi)}</td>
                                  <td className={`tnum text-right ${l.emiChange > 0 ? 'text-negative' : 'text-positive'}`}>
                                    {l.emiChange > 0 ? '+' : '−'}{formatINR(Math.abs(l.emiChange))}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className="mt-2 text-[11px] text-fg-faint">
                            The article comes from MongoDB; your loans from PostgreSQL. Each floating-rate loan is repriced
                            with <span className="tnum">fn_calculate_emi</span> on its outstanding balance and remaining
                            tenure. Assumes full pass-through, as with repo-linked loans; many banks extend the tenure
                            instead of raising the EMI.
                          </p>
                        </>
                      )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { advisorClients } from '@/lib/db/insights';
import { Card, Empty, Stat } from '@/components/ui';
import { formatINR, formatPct } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Advisor-only. An individual who types /advisor is sent home: the role check
 * runs on the server before any client data is queried.
 */
export default async function AdvisorPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'advisor') redirect('/dashboard');

  const clients = await advisorClients(user.id);
  const aum = clients.reduce((s, c) => s + c.totalAssets, 0);
  const needAttention = clients.filter((c) => c.overdue > 0 || (c.debtToAssetPct ?? 0) > 50);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Clients</h1>
        <p className="mt-0.5 text-xs text-fg-muted">
          Clients assigned to you, those needing attention first. Visible only to the advisor role.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Clients" value={clients.length} />
        <Stat label="Assets tracked" value={aum} compact />
        <Stat label="Need attention" value={needAttention.length}
              sub="An overdue EMI, or debt above half of assets" />
      </div>

      <Card>
        {clients.length === 0 ? <Empty>No clients are assigned to you yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Client</th><th className="text-right">Net worth</th><th className="text-right">Debt / assets</th>
                  <th className="text-right">Monthly EMIs</th><th className="text-right">Score</th><th className="text-right">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}<div className="text-[11px] text-fg-faint">{c.email}</div></td>
                    <td className="tnum text-right">{formatINR(c.netWorth, { compact: true })}</td>
                    <td className={`tnum text-right ${(c.debtToAssetPct ?? 0) > 50 ? 'text-negative' : ''}`}>
                      {c.debtToAssetPct === null ? '—' : formatPct(c.debtToAssetPct)}
                    </td>
                    <td className="tnum text-right">{formatINR(c.monthlyEmi, { decimals: false })}</td>
                    <td className="tnum text-right">{c.score ?? '—'}</td>
                    <td className={`tnum text-right ${c.overdue > 0 ? 'font-semibold text-negative' : 'text-fg-faint'}`}>
                      {c.overdue}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-fg-faint">
          One query joins users to v_net_worth_summary, picks each client&apos;s latest score with a LATERAL subquery,
          and counts overdue installments from v_upcoming_emi_dues.
        </p>
      </Card>
    </div>
  );
}

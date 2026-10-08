import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getLoan, getSchedule } from '@/lib/db/loans';
import { ScheduleView } from '@/components/schedule-view';
import { PrepayPanel } from '@/components/prepay-panel';
import { listAssets } from '@/lib/db/assets';

export const dynamic = 'force-dynamic';

export default async function LoanDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const loan = await getLoan(user.id, id);
  if (!loan) notFound();

  const [schedule, assets] = await Promise.all([getSchedule(user.id, id), listAssets(user.id)]);

  return (
    <div className="space-y-4">
      <ScheduleView loan={loan} schedule={schedule} />
      {loan.status === 'active' && loan.outstanding > 0 && (
        <PrepayPanel
          loanId={loan.id}
          outstanding={loan.outstanding}
          assets={assets
            .filter((a) => a.currentValue > 0)
            .sort((a, b) => (a.liquidity === b.liquidity ? b.currentValue - a.currentValue : a.liquidity === 'liquid' ? -1 : 1))
            .map((a) => ({ id: a.id, name: a.name, currentValue: a.currentValue, liquidity: a.liquidity }))}
        />
      )}
    </div>
  );
}

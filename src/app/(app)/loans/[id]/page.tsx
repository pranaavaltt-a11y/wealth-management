import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getLoan, getSchedule } from '@/lib/db/loans';
import { ScheduleView } from '@/components/schedule-view';

export const dynamic = 'force-dynamic';

export default async function LoanDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const loan = await getLoan(user.id, id);
  if (!loan) notFound();

  return <ScheduleView loan={loan} schedule={await getSchedule(user.id, id)} />;
}

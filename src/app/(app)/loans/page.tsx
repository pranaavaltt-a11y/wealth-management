import { requireUser } from '@/lib/auth/session';
import { listLoans } from '@/lib/db/loans';
import { LoansView } from '@/components/loans-view';

export const dynamic = 'force-dynamic';

export default async function LoansPage() {
  const user = await requireUser();
  return <LoansView initial={await listLoans(user.id)} />;
}

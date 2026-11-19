import { requireUser } from '@/lib/auth/session';
import { listTransactions } from '@/lib/db/transactions';
import { TransactionsView } from '@/components/transactions-view';

export const dynamic = 'force-dynamic';

export default async function TransactionsPage() {
  const user = await requireUser();
  return <TransactionsView initial={await listTransactions(user.id, { limit: 200 })} />;
}

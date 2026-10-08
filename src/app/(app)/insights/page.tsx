import { requireUser } from '@/lib/auth/session';
import { creditScore } from '@/lib/db/insights';
import { loanPayoffProgress } from '@/lib/db/views';
import { InsightsView } from '@/components/insights-view';

export const dynamic = 'force-dynamic';

export default async function InsightsPage() {
  const user = await requireUser();
  const [score, loans] = await Promise.all([creditScore(user.id), loanPayoffProgress(user.id)]);
  return (
    <InsightsView
      score={score}
      loans={loans.filter((l) => l.status === 'active').map((l) => ({
        id: l.loanId, lender: l.lender, loanType: l.loanType, outstanding: l.outstanding,
      }))}
    />
  );
}

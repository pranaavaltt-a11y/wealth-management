import { requireUser } from '@/lib/auth/session';
import { currentNetWorth, netWorthTrend, refreshNetWorth } from '@/lib/db/networth';
import { assetAllocation } from '@/lib/db/assets';
import { listLoans } from '@/lib/db/loans';
import { monthlySummary } from '@/lib/db/transactions';
import { apiError, ok } from '@/lib/api';

/**
 * One round-trip for the whole dashboard. The five reads are independent, so
 * they run concurrently on separate pool connections rather than serially.
 */
export async function GET() {
  try {
    const user = await requireUser();

    // A brand-new account has no snapshot until something triggers one.
    if (!(await currentNetWorth(user.id))) await refreshNetWorth(user.id);

    const monthStart = new Date().toISOString().slice(0, 8) + '01';
    const [netWorth, trend, allocation, loans, summary] = await Promise.all([
      currentNetWorth(user.id),
      netWorthTrend(user.id, 365),
      assetAllocation(user.id),
      listLoans(user.id),
      monthlySummary(user.id, monthStart),
    ]);

    return ok({ netWorth, trend, allocation, loans, summary });
  } catch (err) {
    return apiError(err);
  }
}

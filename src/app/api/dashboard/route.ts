import { requireUser } from '@/lib/auth/session';
import { currentNetWorth, netWorthTrend, refreshNetWorth } from '@/lib/db/networth';
import {
  netWorthSummary, allocation, loanPayoffProgress, upcomingDues,
  monthlyCashflow, recurringExpenses, markOverdue,
} from '@/lib/db/views';
import { apiError, ok } from '@/lib/api';

// Reads the session cookie, so it can never be prerendered at build time.
export const dynamic = 'force-dynamic';

/**
 * One round-trip for the whole dashboard. The five reads are independent, so
 * they run concurrently on separate pool connections rather than serially.
 */
export async function GET() {
  try {
    const user = await requireUser();

    // A brand-new account has no snapshot until something triggers one.
    if (!(await currentNetWorth(user.id))) await refreshNetWorth(user.id);
    await markOverdue(user.id);

    const [summary, trend, mix, loans, dues, cashflow, recurring] = await Promise.all([
      netWorthSummary(user.id),
      netWorthTrend(user.id, 400),
      allocation(user.id),
      loanPayoffProgress(user.id),
      upcomingDues(user.id, 45, 10),
      monthlyCashflow(user.id, 12),
      recurringExpenses(user.id, 6),
    ]);

    return ok({ summary, trend, allocation: mix, loans, dues, cashflow, recurring });
  } catch (err) {
    return apiError(err);
  }
}

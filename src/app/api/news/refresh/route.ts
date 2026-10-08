import { requireAdvisor } from '@/lib/auth/session';
import { refreshFromFeed } from '@/lib/services/news-service';
import { apiError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Forces a feed fetch. Advisor-only, so ordinary users cannot hammer the RBI
 * site. Point a cron at this for a fixed schedule.
 */
export async function POST() {
  try {
    await requireAdvisor();
    return ok(await refreshFromFeed());
  } catch (err) {
    if (err instanceof Error && /MongoDB|Feed|fetch|abort/i.test(err.message)) {
      return ok({ error: `Refresh failed: ${err.message}` }, 503);
    }
    return apiError(err);
  }
}

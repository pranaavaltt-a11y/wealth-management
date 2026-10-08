import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { projectNetWorth } from '@/lib/db/insights';
import { getLoan } from '@/lib/db/loans';
import { apiError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

const schema = z.object({
  months: z.coerce.number().int().min(6).max(360).default(60),
  closeLoanId: z.coerce.number().int().positive().optional(),
  growthPct: z.coerce.number().min(0).max(30).default(8),
});

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const q = schema.parse(Object.fromEntries(req.nextUrl.searchParams));
    // The SQL function filters by user_id itself, but checking ownership here
    // turns "someone else's loan" into a clear 404 rather than a quiet no-op.
    if (q.closeLoanId && !(await getLoan(user.id, q.closeLoanId))) {
      return ok({ error: 'Loan not found' }, 404);
    }
    return ok({
      projection: await projectNetWorth(user.id, q.months, q.closeLoanId ?? null, q.growthPct),
    });
  } catch (err) {
    return apiError(err);
  }
}

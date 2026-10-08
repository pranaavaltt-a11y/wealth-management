import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { fyYears, fyReport } from '@/lib/db/insights';
import { financialYear } from '@/lib/format';
import { apiError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const years = await fyYears(user.id);
    const requested = Number(req.nextUrl.searchParams.get('fy'));
    const current = Number(financialYear().start.slice(0, 4));
    const fy = Number.isInteger(requested) && requested > 1990 ? requested : (years[0]?.startYear ?? current);
    return ok({ years, report: await fyReport(user.id, fy) });
  } catch (err) {
    return apiError(err);
  }
}

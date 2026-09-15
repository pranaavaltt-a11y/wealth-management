import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { getLoan, getSchedule } from '@/lib/db/loans';
import { apiError, ok, parseId } from '@/lib/api';

// Reads the session cookie, so it can never be prerendered at build time.
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = parseId(params.id);
    const loan = await getLoan(user.id, id);
    if (!loan) return ok({ error: 'Loan not found' }, 404);
    return ok({ loan, schedule: await getSchedule(user.id, id) });
  } catch (err) {
    return apiError(err);
  }
}

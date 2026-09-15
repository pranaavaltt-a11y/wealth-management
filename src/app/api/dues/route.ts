import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { upcomingDues, markOverdue } from '@/lib/db/views';
import { apiError, ok } from '@/lib/api';

// Reads the session cookie, so it can never be prerendered at build time.
export const dynamic = 'force-dynamic';

/**
 * EMI reminder feed, read from v_upcoming_emi_dues. Past-due installments are
 * flipped to 'overdue' first so the urgency bands are accurate at read time.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const days = Math.min(Number(req.nextUrl.searchParams.get('days') ?? 45) || 45, 365);
    const marked = await markOverdue(user.id);
    return ok({ markedOverdue: marked, dues: await upcomingDues(user.id, days, 100) });
  } catch (err) {
    return apiError(err);
  }
}

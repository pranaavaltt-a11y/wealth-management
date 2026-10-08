import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { simulatePrepayment } from '@/lib/db/insights';
import { apiError, ok, parseId } from '@/lib/api';

export const dynamic = 'force-dynamic';

const schema = z.object({ amount: z.coerce.number().positive().max(1_000_000_000) });

/** Read-only: both prepayment modes priced against the current schedule. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const { amount } = schema.parse(await req.json());
    const result = await simulatePrepayment(user.id, parseId(params.id), amount);
    return result ? ok({ simulation: result }) : ok({ error: 'Loan not found' }, 404);
  } catch (err) {
    return apiError(err);
  }
}

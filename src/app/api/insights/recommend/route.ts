import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { recommend } from '@/lib/db/insights';
import { LOAN_TYPES } from '@/lib/validation/schemas';
import { apiError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

const schema = z.object({
  loanType: z.enum(LOAN_TYPES),
  amount: z.coerce.number().positive().max(1_000_000_000),
  tenureMonths: z.coerce.number().int().min(1).max(480),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const { loanType, amount, tenureMonths } = schema.parse(await req.json());
    return ok({ recommendations: await recommend(user.id, loanType, amount, tenureMonths) });
  } catch (err) {
    return apiError(err);
  }
}

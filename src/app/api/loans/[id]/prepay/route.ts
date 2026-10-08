import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { applyPrepayment } from '@/lib/db/insights';
import { apiError, ok, parseId } from '@/lib/api';

export const dynamic = 'force-dynamic';

const schema = z.object({
  amount: z.coerce.number().positive().max(1_000_000_000),
  mode: z.enum(['reduce_tenure', 'reduce_emi']),
  fromAssetId: z.coerce.number().int().positive().nullable().optional(),
});

/**
 * Applies a prepayment via CALL sp_apply_prepayment. Ownership of both the
 * loan and the source asset is checked inside the procedure, under row locks.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const { amount, mode, fromAssetId } = schema.parse(await req.json());
    return ok(await applyPrepayment(user.id, parseId(params.id), amount, mode, fromAssetId ?? null), 201);
  } catch (err) {
    return apiError(err);
  }
}

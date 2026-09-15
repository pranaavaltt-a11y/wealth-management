import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { payInstallment } from '@/lib/db/loans';
import { apiError, ok, parseId } from '@/lib/api';

/**
 * Atomic EMI payment: flips the installment, writes the ledger entry, and closes
 * the loan if it was the last one — all in one transaction (see payInstallment).
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const result = await payInstallment(user.id, parseId(params.id));
    if (!result) return ok({ error: 'Installment not found, not yours, or already paid.' }, 404);
    return ok(result);
  } catch (err) {
    return apiError(err);
  }
}

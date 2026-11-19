import { requireUser } from '@/lib/auth/session';
import { payInstallment } from '@/lib/db/loans';
import { apiError, ok, parseId } from '@/lib/api';

/**
 * Atomic EMI payment: flips the installment, writes the ledger entry, and closes
 * the loan if it was the last one — all in one transaction (see payInstallment).
 *
 * @param {NextRequest} _req
 * @param {{ params: { id: string } }} arg1
 */
export async function POST(_req, { params }) {
  try {
    const user = await requireUser();
    const result = await payInstallment(user.id, parseId(params.id));
    if (!result) return ok({ error: 'Installment not found, not yours, or already paid.' }, 404);
    return ok(result);
  } catch (err) {
    return apiError(err);
  }
}

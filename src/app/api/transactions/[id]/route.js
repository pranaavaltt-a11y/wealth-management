import { requireUser } from '@/lib/auth/session';
import { deleteTransaction } from '@/lib/db/transactions';
import { apiError, ok, parseId } from '@/lib/api';

/**
 * @param {NextRequest} _req
 * @param {{ params: { id: string } }} arg1
 */
export async function DELETE(_req, { params }) {
  try {
    const user = await requireUser();
    const gone = await deleteTransaction(user.id, parseId(params.id));
    return gone ? ok({ ok: true }) : ok({ error: 'Transaction not found' }, 404);
  } catch (err) {
    return apiError(err);
  }
}

import { requireUser } from '@/lib/auth/session';
import { deleteRule } from '@/lib/db/imports';
import { apiError, ok, parseId } from '@/lib/api';

/**
 * @param {NextRequest} _req
 * @param {{ params: { id: string } }} arg1
 */
export async function DELETE(_req, { params }) {
  try {
    const user = await requireUser();
    const gone = await deleteRule(user.id, parseId(params.id));
    // System rules are shared, so they are never deletable by a user.
    return gone ? ok({ ok: true }) : ok({ error: 'Rule not found, or it is a system rule.' }, 404);
  } catch (err) {
    return apiError(err);
  }
}

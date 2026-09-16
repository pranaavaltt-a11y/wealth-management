import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { deleteRule } from '@/lib/db/imports';
import { apiError, ok, parseId } from '@/lib/api';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const gone = await deleteRule(user.id, parseId(params.id));
    // System rules are shared, so they are never deletable by a user.
    return gone ? ok({ ok: true }) : ok({ error: 'Rule not found, or it is a system rule.' }, 404);
  } catch (err) {
    return apiError(err);
  }
}

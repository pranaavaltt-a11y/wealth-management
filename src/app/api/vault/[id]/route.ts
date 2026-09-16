import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { deleteDocument, VaultError } from '@/lib/services/vault-service';
import { apiError, ok } from '@/lib/api';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const gone = await deleteDocument(user.id, params.id);
    return gone ? ok({ ok: true }) : ok({ error: 'Document not found' }, 404);
  } catch (err) {
    if (err instanceof VaultError) return ok({ error: err.message }, err.status);
    return apiError(err);
  }
}

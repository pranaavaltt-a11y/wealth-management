import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { saveDocument, listDocuments, vaultStats, VaultError, MAX_FILE_BYTES } from '@/lib/services/vault-service';
import { isMongoConfigured } from '@/lib/db/mongo';
import { apiError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const p = req.nextUrl.searchParams;
    const documents = await listDocuments(user.id, {
      refType: p.get('refType') ?? undefined,
      refId: p.get('refId') ? Number(p.get('refId')) : undefined,
      tag: p.get('tag') ?? undefined,
      search: p.get('search') ?? undefined,
    });

    // listDocuments returns null specifically when Mongo is unreachable, so the
    // UI can say "vault unavailable" rather than "you have no documents".
    if (documents === null) {
      return ok({ available: false, mongoConfigured: isMongoConfigured(), documents: [], stats: null });
    }
    return ok({ available: true, mongoConfigured: true, documents, stats: await vaultStats(user.id) });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return ok({ error: 'No file uploaded.' }, 422);
    if (file.size > MAX_FILE_BYTES) return ok({ error: 'File exceeds the 10MB limit.' }, 413);

    const refTypeRaw = String(form.get('refType') ?? 'general');
    const refType = (['loan', 'asset', 'general'] as const).includes(refTypeRaw as never)
      ? (refTypeRaw as 'loan' | 'asset' | 'general')
      : 'general';
    const refIdRaw = form.get('refId');
    const refId = refIdRaw ? Number(refIdRaw) : null;

    const document = await saveDocument({
      userId: user.id,
      refType,
      refId: Number.isInteger(refId) && refId! > 0 ? refId : null,
      title: String(form.get('title') ?? ''),
      tags: String(form.get('tags') ?? '').split(',').filter(Boolean),
      originalName: file.name,
      mimeType: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });

    return ok({ document }, 201);
  } catch (err) {
    if (err instanceof VaultError) return ok({ error: err.message }, err.status);
    return apiError(err);
  }
}

import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { getAsset, updateAsset, deleteAsset } from '@/lib/db/assets';
import { recordValuation, getValuationHistory, deleteValuationHistory } from '@/lib/services/valuation-service';
import { assetSchema } from '@/lib/validation/schemas';
import { apiError, ok, parseId } from '@/lib/api';

// Reads the session cookie, so it can never be prerendered at build time.
export const dynamic = 'force-dynamic';

interface Ctx { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    const id = parseId(params.id);
    const asset = await getAsset(user.id, id);
    if (!asset) return ok({ error: 'Asset not found' }, 404);
    return ok({ asset, valuationHistory: await getValuationHistory(user.id, id) });
  } catch (err) {
    return apiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    const id = parseId(params.id);
    const input = assetSchema.parse(await req.json());
    const asset = await updateAsset(user.id, id, input);
    if (!asset) return ok({ error: 'Asset not found' }, 404);

    // Every revaluation appends to the Mongo history rather than overwriting,
    // which is what makes the valuation trend chart possible.
    await recordValuation({
      userId: user.id,
      assetId: id,
      valuationDate: asset.valuationDate,
      value: asset.currentValue,
      typeSpecificMetadata: { assetType: asset.assetType, source: 'revaluation' },
    });
    return ok({ asset });
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    const id = parseId(params.id);
    if (!(await deleteAsset(user.id, id))) return ok({ error: 'Asset not found' }, 404);
    await deleteValuationHistory(user.id, id);
    return ok({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}

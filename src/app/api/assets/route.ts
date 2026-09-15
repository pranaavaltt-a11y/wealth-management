import type { NextRequest } from 'next/server';
import { requireUser, resolveTargetUserId, AuthError } from '@/lib/auth/session';
import { advisorOwnsClient } from '@/lib/db/users';
import { listAssets, createAsset } from '@/lib/db/assets';
import { recordValuation } from '@/lib/services/valuation-service';
import { assetSchema } from '@/lib/validation/schemas';
import { apiError, ok } from '@/lib/api';

/** Advisors may read a client's data only if that client is assigned to them. */
async function scopedUserId(req: NextRequest) {
  const user = await requireUser();
  const targetId = resolveTargetUserId(user, req.nextUrl.searchParams.get('userId'));
  if (targetId !== user.id && !(await advisorOwnsClient(user.id, targetId))) {
    throw new AuthError(403, 'That client is not assigned to you.');
  }
  return targetId;
}

export async function GET(req: NextRequest) {
  try {
    return ok({ assets: await listAssets(await scopedUserId(req)) });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const input = assetSchema.parse(await req.json());
    const asset = await createAsset(user.id, input);

    // Mirror the opening valuation into Mongo so the history chart has a first
    // point. Fire-and-forget: Postgres already holds the authoritative value.
    await recordValuation({
      userId: user.id,
      assetId: asset.id,
      valuationDate: asset.valuationDate,
      value: asset.currentValue,
      typeSpecificMetadata: { assetType: asset.assetType, source: 'manual-entry' },
    });

    return ok({ asset }, 201);
  } catch (err) {
    return apiError(err);
  }
}

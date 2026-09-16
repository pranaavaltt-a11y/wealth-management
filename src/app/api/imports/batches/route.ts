import { requireUser } from '@/lib/auth/session';
import { listBatches, importStatsByBank } from '@/lib/services/import-service';
import { isMongoConfigured } from '@/lib/db/mongo';
import { apiError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Import history, including the per-bank Mongo aggregation rollup. */
export async function GET() {
  try {
    const user = await requireUser();
    const [batches, statsByBank] = await Promise.all([
      listBatches(user.id),
      importStatsByBank(user.id),
    ]);
    return ok({ mongoConfigured: isMongoConfigured(), batches, statsByBank });
  } catch (err) {
    return apiError(err);
  }
}

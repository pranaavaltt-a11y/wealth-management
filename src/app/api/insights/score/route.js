import { requireUser } from '@/lib/auth/session';
import { creditScore } from '@/lib/db/insights';
import { apiError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    return ok({ score: await creditScore(user.id) });
  } catch (err) {
    return apiError(err);
  }
}

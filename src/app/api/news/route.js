import { requireUser } from '@/lib/auth/session';
import { getFeed } from '@/lib/services/news-service';
import { apiError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * @param {NextRequest} req
 */
export async function GET(req) {
  try {
    await requireUser();
    return ok(await getFeed(req.nextUrl.searchParams.get('category') ?? undefined));
  } catch (err) {
    return apiError(err);
  }
}

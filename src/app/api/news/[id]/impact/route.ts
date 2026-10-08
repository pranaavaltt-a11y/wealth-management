import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { getArticle } from '@/lib/services/news-service';
import { rateImpact } from '@/lib/db/insights';
import { apiError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Cross-database query: the article comes from MongoDB (or the sample set),
 * the user's floating-rate loans from PostgreSQL.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const article = await getArticle(params.id);
    if (!article) return ok({ error: 'Article not found' }, 404);
    if (article.rateChangeBps === null) {
      return ok({ article, impact: null, note: 'This article does not describe a lending-rate change.' });
    }
    return ok({ article, impact: await rateImpact(user.id, article.rateChangeBps), note: null });
  } catch (err) {
    return apiError(err);
  }
}

import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { getFeed } from '@/lib/services/news-service';
import { apiError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    return ok(await getFeed(req.nextUrl.searchParams.get('category') ?? undefined));
  } catch (err) {
    return apiError(err);
  }
}

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { notifications, markNotificationsRead } from '@/lib/db/insights';
import { apiError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    const list = await notifications(user.id);
    return ok({ notifications: list, unread: list.filter((n) => !n.isRead).length });
  } catch (err) {
    return apiError(err);
  }
}

const schema = z.object({ id: z.coerce.number().int().positive().optional() });

/** Mark one notification read, or all of them when no id is given. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const { id } = schema.parse(await req.json().catch(() => ({})));
    await markNotificationsRead(user.id, id);
    return ok({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}

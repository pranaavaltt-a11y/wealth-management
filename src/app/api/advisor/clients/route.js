import { requireAdvisor } from '@/lib/auth/session';
import { advisorClients } from '@/lib/db/insights';
import { apiError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Advisor-only. An individual calling this gets a 403 from requireAdvisor. */
export async function GET() {
  try {
    const advisor = await requireAdvisor();
    return ok({ clients: await advisorClients(advisor.id) });
  } catch (err) {
    return apiError(err);
  }
}

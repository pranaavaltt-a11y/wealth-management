import { getCurrentUser } from '@/lib/auth/session';
import { ok } from '@/lib/api';

// Reads the session cookie, so it can never be prerendered at build time.
export const dynamic = 'force-dynamic';

export async function GET() {
  return ok({ user: await getCurrentUser() });
}

import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { listLoans, createLoan } from '@/lib/db/loans';
import { loanSchema } from '@/lib/validation/schemas';
import { apiError, ok } from '@/lib/api';

// Reads the session cookie, so it can never be prerendered at build time.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    return ok({ loans: await listLoans(user.id) });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const input = loanSchema.parse(await req.json());
    // createLoan() runs the INSERT and fn_generate_emi_schedule() in one txn.
    return ok({ loan: await createLoan(user.id, input) }, 201);
  } catch (err) {
    return apiError(err);
  }
}

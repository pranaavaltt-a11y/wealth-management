import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { getLoan, updateLoan, deleteLoan, setLoanStatus } from '@/lib/db/loans';
import { loanSchema } from '@/lib/validation/schemas';
import { apiError, ok, parseId } from '@/lib/api';
import { z } from 'zod';

// Reads the session cookie, so it can never be prerendered at build time.
export const dynamic = 'force-dynamic';

interface Ctx { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    const loan = await getLoan(user.id, parseId(params.id));
    return loan ? ok({ loan }) : ok({ error: 'Loan not found' }, 404);
  } catch (err) {
    return apiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    const loan = await updateLoan(user.id, parseId(params.id), loanSchema.parse(await req.json()));
    return loan ? ok({ loan }) : ok({ error: 'Loan not found' }, 404);
  } catch (err) {
    return apiError(err);
  }
}

const statusSchema = z.object({ status: z.enum(['active', 'closed', 'defaulted']) });

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { status } = statusSchema.parse(await req.json());
    const changed = await setLoanStatus(user.id, parseId(params.id), status);
    return changed ? ok({ ok: true }) : ok({ error: 'Loan not found' }, 404);
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const user = await requireUser();
    const gone = await deleteLoan(user.id, parseId(params.id));
    return gone ? ok({ ok: true }) : ok({ error: 'Loan not found' }, 404);
  } catch (err) {
    return apiError(err);
  }
}

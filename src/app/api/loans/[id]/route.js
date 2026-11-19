import { requireUser } from '@/lib/auth/session';
import { getLoan, updateLoan, deleteLoan, setLoanStatus } from '@/lib/db/loans';
import { loanSchema } from '@/lib/validation/schemas';
import { apiError, ok, parseId } from '@/lib/api';
import { z } from 'zod';

// Reads the session cookie, so it can never be prerendered at build time.
export const dynamic = 'force-dynamic';

/**
 * @typedef {object} Ctx
 * @property {{ id: string }} params
 */

/**
 * @param {NextRequest} _req
 * @param {Ctx} arg1
 */
export async function GET(_req, { params }) {
  try {
    const user = await requireUser();
    const loan = await getLoan(user.id, parseId(params.id));
    return loan ? ok({ loan }) : ok({ error: 'Loan not found' }, 404);
  } catch (err) {
    return apiError(err);
  }
}

/**
 * @param {NextRequest} req
 * @param {Ctx} arg1
 */
export async function PUT(req, { params }) {
  try {
    const user = await requireUser();
    const loan = await updateLoan(user.id, parseId(params.id), loanSchema.parse(await req.json()));
    return loan ? ok({ loan }) : ok({ error: 'Loan not found' }, 404);
  } catch (err) {
    return apiError(err);
  }
}

const statusSchema = z.object({ status: z.enum(['active', 'closed', 'defaulted']) });

/**
 * @param {NextRequest} req
 * @param {Ctx} arg1
 */
export async function PATCH(req, { params }) {
  try {
    const user = await requireUser();
    const { status } = statusSchema.parse(await req.json());
    const changed = await setLoanStatus(user.id, parseId(params.id), status);
    return changed ? ok({ ok: true }) : ok({ error: 'Loan not found' }, 404);
  } catch (err) {
    return apiError(err);
  }
}

/**
 * @param {NextRequest} _req
 * @param {Ctx} arg1
 */
export async function DELETE(_req, { params }) {
  try {
    const user = await requireUser();
    const gone = await deleteLoan(user.id, parseId(params.id));
    return gone ? ok({ ok: true }) : ok({ error: 'Loan not found' }, 404);
  } catch (err) {
    return apiError(err);
  }
}

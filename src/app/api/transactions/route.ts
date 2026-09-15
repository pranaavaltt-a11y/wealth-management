import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { listTransactions, createTransaction } from '@/lib/db/transactions';
import { transactionSchema } from '@/lib/validation/schemas';
import { apiError, ok } from '@/lib/api';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const p = req.nextUrl.searchParams;
    const transactions = await listTransactions(user.id, {
      type: p.get('type') ?? undefined,
      from: p.get('from') ?? undefined,
      to: p.get('to') ?? undefined,
      category: p.get('category') ?? undefined,
      limit: p.get('limit') ? Math.min(Number(p.get('limit')), 500) : undefined,
    });
    return ok({ transactions });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const input = transactionSchema.parse(await req.json());
    return ok({ transaction: await createTransaction(user.id, input) }, 201);
  } catch (err) {
    return apiError(err);
  }
}

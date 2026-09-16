import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { listRules, createRule, recategorise } from '@/lib/db/imports';
import { apiError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    return ok({ rules: await listRules(user.id) });
  } catch (err) {
    return apiError(err);
  }
}

const ruleSchema = z.object({
  keyword: z.string().trim().min(2, 'Keyword must be at least 2 characters').max(60),
  category: z.string().trim().min(1).max(80),
  txnType: z.enum(['income', 'expense', 'asset', 'loan']).default('expense'),
  priority: z.coerce.number().int().min(1).max(999).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const rule = await createRule(user.id, ruleSchema.parse(await req.json()));

    // Applying the rule retroactively is a convenience, not part of creating
    // it. If the sweep fails the rule still exists and still applies to future
    // imports, so the failure is reported rather than losing the rule to a 500.
    let recategorised: number | null = null;
    try {
      recategorised = await recategorise(user.id);
    } catch (sweepErr) {
      console.error('[rules] rule created but retroactive sweep failed:', sweepErr);
    }

    return ok({ rule, recategorised }, 201);
  } catch (err) {
    return apiError(err);
  }
}

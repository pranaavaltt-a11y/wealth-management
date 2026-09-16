import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { commitImport, type CategorisedRow } from '@/lib/db/imports';
import { markBatchCommitted } from '@/lib/services/import-service';
import { apiError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Step 2 of 2. The rows come back from the client because the user may have
 * changed categories in the preview — so every field is re-validated here
 * rather than trusted.
 */
const rowSchema = z.object({
  txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().min(1).max(500),
  amount: z.coerce.number().positive().max(9_999_999_999),
  txnType: z.enum(['income', 'expense']),
  category: z.string().trim().min(1).max(80),
  importHash: z.string().regex(/^[a-f0-9]{32}$/),
});

const commitSchema = z.object({
  batchId: z.string().nullable().optional(),
  rows: z.array(rowSchema).min(1, 'Nothing selected to import').max(5000),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const { batchId, rows } = commitSchema.parse(await req.json());

    const result = await commitImport(
      user.id,
      rows.map((r) => ({ ...r, rowNumber: 0, reference: null, matchedKeyword: null })) as CategorisedRow[],
      batchId ?? null,
    );

    if (batchId) await markBatchCommitted(batchId, result.inserted);
    return ok(result, 201);
  } catch (err) {
    return apiError(err);
  }
}

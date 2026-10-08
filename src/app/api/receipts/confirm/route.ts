import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { createReceiptTransaction } from '@/lib/db/transactions';
import { importHash } from '@/lib/services/csv-parser';
import { saveDocument, VaultError } from '@/lib/services/vault-service';
import { apiError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  merchant: z.string().trim().min(1).max(120),
  amount: z.coerce.number().positive().max(10_000_000),
  txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.string().trim().min(1).max(80),
  keepImage: z.enum(['true', 'false']).default('true'),
});

/**
 * Step 2 of 2: the user-confirmed fields become an expense. The image is
 * re-sent so it can be filed in the document vault — best-effort, because the
 * vault needs MongoDB and the expense should not depend on it.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const input = schema.parse({
      ...Object.fromEntries(['merchant', 'amount', 'txnDate', 'category'].map((k) => [k, form.get(k) ?? undefined])),
      // An unchecked checkbox is simply absent from the form.
      keepImage: form.get('keepImage') === 'true' ? 'true' : 'false',
    });

    const txn = await createReceiptTransaction(user.id, {
      amount: input.amount,
      txnDate: input.txnDate,
      merchant: input.merchant,
      category: input.category,
      importHash: importHash(input.txnDate, input.amount, `RECEIPT|${input.merchant}`),
    });
    if (!txn) {
      return ok({ error: 'A receipt from this merchant for this amount and date is already recorded.' }, 409);
    }

    let filed = false;
    const file = form.get('file');
    if (input.keepImage === 'true' && file instanceof File && file.size > 0) {
      try {
        await saveDocument({
          userId: user.id, refType: 'general', refId: null,
          title: `Receipt — ${input.merchant}`, tags: ['receipt', input.category],
          originalName: file.name, mimeType: file.type,
          bytes: Buffer.from(await file.arrayBuffer()),
        });
        filed = true;
      } catch (e) {
        if (!(e instanceof VaultError)) throw e;   // vault unavailable: keep the expense
      }
    }

    return ok({ transaction: txn, filedInVault: filed }, 201);
  } catch (err) {
    return apiError(err);
  }
}

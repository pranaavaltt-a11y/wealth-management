import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { recogniseImage, extractReceiptFields } from '@/lib/services/ocr-service';
import { query } from '@/lib/db/postgres';
import { apiError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Step 1 of 2: OCR only. Nothing is saved — the user confirms or corrects the
 * extracted fields first, because OCR on a photographed receipt is never
 * reliable enough to write straight to the ledger.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const file = (await req.formData()).get('file');
    if (!(file instanceof File)) return ok({ error: 'No image uploaded.' }, 422);
    if (!IMAGE_TYPES.includes(file.type)) {
      return ok({ error: 'Upload a JPEG, PNG or WebP photo of the receipt.' }, 415);
    }
    if (file.size > MAX_BYTES) return ok({ error: 'Image exceeds the 8MB limit.' }, 413);

    const { text, confidence } = await recogniseImage(Buffer.from(await file.arrayBuffer()));
    const fields = extractReceiptFields(text);

    // Suggest a category by running the merchant line (and the top of the
    // receipt, which often names the shop type) through the SQL rule engine.
    const probe = `${fields.merchant ?? ''} ${text.slice(0, 300)}`;
    const [hit] = await query<{ category: string }>(
      'SELECT category FROM fn_categorize($1, $2)', [user.id, probe],
    );

    return ok({
      confidence,
      text,
      fields: { ...fields, category: hit?.category ?? 'Uncategorized' },
    });
  } catch (err) {
    return apiError(err);
  }
}

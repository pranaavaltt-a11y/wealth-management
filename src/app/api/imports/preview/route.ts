import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { buildPreview } from '@/lib/services/import-service';
import { apiError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

const MAX_CSV_BYTES = 5 * 1024 * 1024;

/** Step 1 of 2: parse, stage, categorise and show the user what will land. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const file = form.get('file');

    if (!(file instanceof File)) return ok({ error: 'No file uploaded.' }, 422);
    if (file.size === 0) return ok({ error: 'That file is empty.' }, 422);
    if (file.size > MAX_CSV_BYTES) return ok({ error: 'Statement exceeds the 5MB limit.' }, 413);
    if (!/\.csv$/i.test(file.name)) {
      return ok({ error: 'Only .csv statements are supported. Export one from your net banking.' }, 415);
    }

    const text = await file.text();
    return ok({ preview: await buildPreview(user.id, file.name, text) });
  } catch (err) {
    // A malformed statement is the user's problem to fix, not a 500.
    if (err instanceof Error && err.message.startsWith('Could not find a header row')) {
      return ok({ error: err.message }, 422);
    }
    return apiError(err);
  }
}

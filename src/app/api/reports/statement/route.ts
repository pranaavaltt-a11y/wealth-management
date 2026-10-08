import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { buildStatementPdf } from '@/lib/services/statement-pdf';
import { apiError } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';   // pdfkit needs fs; not available on the Edge runtime

export async function GET() {
  try {
    const user = await requireUser();
    const pdf = await buildStatementPdf(user.id);
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="wealthwise-statement-${stamp}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    return apiError(err);
  }
}

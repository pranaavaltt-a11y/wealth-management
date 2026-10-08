import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthError } from '@/lib/auth/session';
import { ServiceError } from '@/lib/services/auth-service';

/**
 * One error funnel for every route handler, so no handler ever leaks a stack
 * trace or a raw Postgres message to the client.
 */
export function apiError(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    const fieldErrors = err.flatten().fieldErrors;
    return NextResponse.json(
      { error: 'Validation failed', fields: fieldErrors },
      { status: 422 },
    );
  }
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof ServiceError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  // Postgres constraint violations become friendly 409/422s instead of 500s.
  const pg = err as { code?: string; constraint?: string; detail?: string; message?: string; hint?: string };

  // Our own stored procedures raise SQLSTATEs of the form WWnnn, where nnn is
  // the HTTP status to return. The message was written by us in the
  // migration, so it is safe to show the user verbatim.
  if (pg?.code && /^WW\d{3}$/.test(pg.code)) {
    return NextResponse.json(
      { error: pg.message, hint: pg.hint },
      { status: Number(pg.code.slice(2)) },
    );
  }
  if (pg?.code === '23505') {
    return NextResponse.json({ error: 'That record already exists.' }, { status: 409 });
  }
  if (pg?.code === '23514') {
    return NextResponse.json(
      { error: `A database constraint rejected this value (${pg.constraint ?? 'check'}).` },
      { status: 422 },
    );
  }
  if (pg?.code === '23503') {
    return NextResponse.json({ error: 'Referenced record does not exist.' }, { status: 422 });
  }

  console.error('[api] unhandled error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/** Parses a route param that must be a positive integer id. */
export function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new AuthError(403, 'Invalid id.');
  return id;
}

/**
 * Points every database connection at a dedicated TEST database before any
 * app module creates its pool. Must be the first import of every DB test
 * (helpers.ts imports it first), so tests can never touch demo or real data.
 */
import 'dotenv/config';

export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('Set DATABASE_URL or TEST_DATABASE_URL.');
  const url = new URL(base);
  if (!url.pathname.endsWith('_test')) url.pathname = `${url.pathname}_test`;
  return url.toString();
}

process.env.DATABASE_URL = testDatabaseUrl();
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-123';

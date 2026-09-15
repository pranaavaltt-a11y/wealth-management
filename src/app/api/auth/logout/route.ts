import { NextResponse } from 'next/server';
import { sessionCookieOptions } from '@/lib/auth/cookie';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ ...sessionCookieOptions(0), value: '' });   // maxAge 0 == delete
  return res;
}

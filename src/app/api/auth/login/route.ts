import { NextResponse, type NextRequest } from 'next/server';
import { loginSchema } from '@/lib/validation/schemas';
import { login } from '@/lib/services/auth-service';
import { sessionCookieOptions } from '@/lib/auth/cookie';
import { apiError } from '@/lib/api';

export async function POST(req: NextRequest) {
  try {
    const input = loginSchema.parse(await req.json());
    const { token, user } = await login(input);
    const res = NextResponse.json({ user });
    res.cookies.set({ ...sessionCookieOptions(), value: token });
    return res;
  } catch (err) {
    return apiError(err);
  }
}

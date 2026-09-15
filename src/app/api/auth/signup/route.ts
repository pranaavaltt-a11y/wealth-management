import { NextResponse, type NextRequest } from 'next/server';
import { signupSchema } from '@/lib/validation/schemas';
import { signup } from '@/lib/services/auth-service';
import { sessionCookieOptions } from '@/lib/auth/cookie';
import { apiError } from '@/lib/api';

export async function POST(req: NextRequest) {
  try {
    const input = signupSchema.parse(await req.json());
    const { token, user } = await signup(input);
    const res = NextResponse.json({ user }, { status: 201 });
    res.cookies.set({ ...sessionCookieOptions(), value: token });
    return res;
  } catch (err) {
    return apiError(err);
  }
}

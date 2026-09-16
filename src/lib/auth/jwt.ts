import { SignJWT, jwtVerify } from 'jose';

/**
 * JWTs are signed with HS256 using `jose` rather than `jsonwebtoken` because
 * jose runs on the Edge runtime, which is what Next.js middleware executes in.
 */
export interface SessionClaims {
  sub: string;            // user id, as a string (JWT `sub` must be a string)
  email: string;
  name: string;
  role: 'individual' | 'advisor';
}

export const SESSION_COOKIE = 'ww_session';

function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters long.');
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ email: claims.email, name: claims.name, role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer('wealthwise')
    .setExpirationTime(process.env.JWT_EXPIRES_IN ?? '7d')
    .sign(secretKey());
}

export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: 'wealthwise' });
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ''),
      name: String(payload.name ?? ''),
      role: payload.role === 'advisor' ? 'advisor' : 'individual',
    };
  } catch {
    return null;   // expired, tampered, or wrong secret — all mean "no session"
  }
}

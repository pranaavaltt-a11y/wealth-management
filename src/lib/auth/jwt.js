import { SignJWT, jwtVerify } from 'jose';

/**
 * JWTs are signed with HS256 using `jose` rather than `jsonwebtoken` because
 * jose runs on the Edge runtime, which is what Next.js middleware executes in.
 *
 * @typedef {object} SessionClaims
 * @property {string} sub - user id, as a string (JWT `sub` must be a string)
 * @property {string} email
 * @property {string} name
 * @property {'individual' | 'advisor'} role
 */

export const SESSION_COOKIE = 'ww_session';

/**
 * @returns {Uint8Array}
 */
function secretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters long.');
  }
  return new TextEncoder().encode(secret);
}

/**
 * @param {SessionClaims} claims
 * @returns {Promise<string>}
 */
export async function signSession(claims) {
  return new SignJWT({ email: claims.email, name: claims.name, role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer('wealthwise')
    .setExpirationTime(process.env.JWT_EXPIRES_IN ?? '7d')
    .sign(secretKey());
}

/**
 * @param {string} token
 * @returns {Promise<SessionClaims | null>}
 */
export async function verifySession(token) {
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
    return null; // expired, tampered, or wrong secret — all mean "no session"
  }
}

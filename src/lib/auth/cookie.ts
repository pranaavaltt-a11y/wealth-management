import { SESSION_COOKIE } from './jwt';

/**
 * httpOnly so JavaScript (and thus XSS) cannot read the token;
 * sameSite=lax so it survives normal navigation but not cross-site POSTs;
 * secure only in production, otherwise localhost over http would drop it.
 */
export function sessionCookieOptions(maxAgeSeconds = 60 * 60 * 24 * 7) {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

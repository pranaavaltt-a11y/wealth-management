import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession } from './jwt';

/**
 * @typedef {object} CurrentUser
 * @property {number} id
 * @property {string} email
 * @property {string} name
 * @property {'individual' | 'advisor'} role
 */

/**
 * @param {SessionClaims} claims
 * @returns {CurrentUser}
 */
function toUser(claims) {
  return { id: Number(claims.sub), email: claims.email, name: claims.name, role: claims.role };
}

/**
 * Reads the session cookie. Returns null when signed out.
 *
 * @returns {Promise<CurrentUser | null>}
 */
export async function getCurrentUser() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await verifySession(token);
  return claims ? toUser(claims) : null;
}

/** Thrown by requireUser/requireAdvisor; mapped to a 401/403 by the API layer. */
export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = 'AuthError';
  }
}

/**
 * @returns {Promise<CurrentUser>}
 */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new AuthError(401, 'Authentication required.');
  return user;
}

/**
 * Advisor/admin-only routes.
 *
 * @returns {Promise<CurrentUser>}
 */
export async function requireAdvisor() {
  const user = await requireUser();
  if (user.role !== 'advisor') throw new AuthError(403, 'Advisor role required.');
  return user;
}

/**
 * Resolves which user's data a request is allowed to read.
 * An individual may only ever see their own; an advisor may pass ?userId= to
 * view a client, but only a client actually assigned to them (checked in the
 * data layer via the advisor_id column).
 *
 * @param {CurrentUser} user
 * @param {string | null} [requested]
 * @returns {number}
 */
export function resolveTargetUserId(user, requested) {
  if (!requested) return user.id;
  const id = Number(requested);
  if (!Number.isInteger(id) || id <= 0) throw new AuthError(403, 'Invalid user id.');
  if (user.role !== 'advisor' && id !== user.id) {
    throw new AuthError(403, 'You may only access your own data.');
  }
  return id;
}

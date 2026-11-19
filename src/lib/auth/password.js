import bcrypt from 'bcryptjs';

// 12 rounds: ~250ms on typical hardware. Slow enough to matter for offline
// cracking, fast enough that login does not feel laggy.
const SALT_ROUNDS = 12;

/**
 * @param {string} plain
 * @returns {Promise<string>}
 */
export function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/**
 * @param {string} plain
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

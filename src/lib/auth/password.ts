import bcrypt from 'bcryptjs';

// 12 rounds: ~250ms on typical hardware. Slow enough to matter for offline
// cracking, fast enough that login does not feel laggy.
const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

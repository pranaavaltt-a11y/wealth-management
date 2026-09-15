import { createUser, findUserByEmail, type UserRow } from '@/lib/db/users';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { signSession } from '@/lib/auth/jwt';
import type { LoginInput, SignupInput } from '@/lib/validation/schemas';

export class ServiceError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ServiceError';
  }
}

interface AuthResult { token: string; user: Pick<UserRow, 'id' | 'name' | 'email' | 'role'> }

async function issue(user: UserRow): Promise<AuthResult> {
  const token = await signSession({
    sub: String(user.id),
    email: user.email,
    name: user.name,
    role: user.role,
  });
  return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
}

export async function signup(input: SignupInput): Promise<AuthResult> {
  if (await findUserByEmail(input.email)) {
    throw new ServiceError(409, 'An account with that email already exists.');
  }
  const user = await createUser({
    name: input.name,
    email: input.email,
    passwordHash: await hashPassword(input.password),
    role: input.role,
    panNumber: input.panNumber ?? null,
  });
  return issue(user);
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const user = await findUserByEmail(input.email);

  // Deliberately identical message and comparable timing for "no such user" and
  // "wrong password", so the endpoint cannot be used to enumerate accounts.
  if (!user) {
    await verifyPassword(input.password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvaliduu');
    throw new ServiceError(401, 'Invalid email or password.');
  }
  if (!(await verifyPassword(input.password, user.password_hash))) {
    throw new ServiceError(401, 'Invalid email or password.');
  }
  return issue(user);
}

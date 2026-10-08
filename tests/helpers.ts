import './env';   // MUST stay first: retargets DATABASE_URL before the pool exists
import { pool } from '../src/lib/db/postgres';

export { pool };

let seq = 0;
const tag = `${process.pid}-${Date.now()}`;

/** Each test file builds its own users, so files never share state. */
export async function makeUser(role: 'individual' | 'advisor' = 'individual'): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, 'x', $3) RETURNING id`,
    [`Test ${++seq}`, `t${seq}-${tag}@test.dev`, role],
  );
  return rows[0].id;
}

export async function makeLoan(userId: number, o: {
  principal?: number; rate?: number; tenure?: number; start?: string;
  type?: string; interestType?: 'fixed' | 'floating';
} = {}): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO loans (user_id, loan_type, lender, principal, interest_rate, interest_type, tenure_months, start_date)
     VALUES ($1, $2, 'Test Bank', $3, $4, $5, $6, $7) RETURNING id`,
    [userId, o.type ?? 'home', o.principal ?? 1_000_000, o.rate ?? 9, o.interestType ?? 'fixed',
     o.tenure ?? 120, o.start ?? '2024-01-01'],
  );
  await pool.query('SELECT fn_generate_emi_schedule($1)', [rows[0].id]);
  return rows[0].id;
}

export async function makeAsset(userId: number, value: number, type = 'cash', liquidity = 'liquid'): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO assets (user_id, name, asset_type, purchase_value, current_value, purchase_date, liquidity)
     VALUES ($1, 'Test asset', $2, $3, $3, '2020-01-01', $4) RETURNING id`,
    [userId, type, value, liquidity],
  );
  return rows[0].id;
}

/** Marks the first n installments paid on their due dates. */
export async function payFirst(loanId: number, n: number): Promise<void> {
  await pool.query(
    `UPDATE emi_schedule SET status = 'paid', paid_date = due_date
      WHERE loan_id = $1 AND installment_no <= $2`,
    [loanId, n],
  );
}

export async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await pool.query(sql, params);
  return rows[0] as T;
}

/** Asserts that a statement fails with the given SQLSTATE. */
export async function rejectsWith(code: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const got = (e as { code?: string }).code;
    if (got === code) return;
    throw new Error(`Expected SQLSTATE ${code}, got ${got}: ${(e as Error).message}`);
  }
  throw new Error(`Expected SQLSTATE ${code}, but the statement succeeded`);
}

import './env'; // MUST stay first: retargets DATABASE_URL before the pool exists
import { pool } from '../src/lib/db/postgres';

export { pool };

let seq = 0;
const tag = `${process.pid}-${Date.now()}`;

/**
 * Each test file builds its own users, so files never share state.
 *
 * @param {'individual' | 'advisor'} [role='individual']
 * @returns {Promise<number>}
 */
export async function makeUser(role = 'individual') {
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, 'x', $3) RETURNING id`,
    [`Test ${++seq}`, `t${seq}-${tag}@test.dev`, role],
  );
  return rows[0].id;
}

/**
 * @param {number} userId
 * @param {{ principal?: number, rate?: number, tenure?: number, start?: string, type?: string, interestType?: 'fixed' | 'floating' }} [o={}]
 * @returns {Promise<number>}
 */
export async function makeLoan(userId, o = {}) {
  const { rows } = await pool.query(
    `INSERT INTO loans (user_id, loan_type, lender, principal, interest_rate, interest_type, tenure_months, start_date)
     VALUES ($1, $2, 'Test Bank', $3, $4, $5, $6, $7) RETURNING id`,
    [
      userId,
      o.type ?? 'home',
      o.principal ?? 1_000_000,
      o.rate ?? 9,
      o.interestType ?? 'fixed',
      o.tenure ?? 120,
      o.start ?? '2024-01-01',
    ],
  );
  await pool.query('SELECT fn_generate_emi_schedule($1)', [rows[0].id]);
  return rows[0].id;
}

/**
 * @param {number} userId
 * @param {number} value
 * @param {string} [type='cash']
 * @param {string} [liquidity='liquid']
 * @returns {Promise<number>}
 */
export async function makeAsset(userId, value, type = 'cash', liquidity = 'liquid') {
  const { rows } = await pool.query(
    `INSERT INTO assets (user_id, name, asset_type, purchase_value, current_value, purchase_date, liquidity)
     VALUES ($1, 'Test asset', $2, $3, $3, '2020-01-01', $4) RETURNING id`,
    [userId, type, value, liquidity],
  );
  return rows[0].id;
}

/**
 * Marks the first n installments paid on their due dates.
 *
 * @param {number} loanId
 * @param {number} n
 * @returns {Promise<void>}
 */
export async function payFirst(loanId, n) {
  await pool.query(
    `UPDATE emi_schedule SET status = 'paid', paid_date = due_date
      WHERE loan_id = $1 AND installment_no <= $2`,
    [loanId, n],
  );
}

/**
 * @template T
 * @param {string} sql
 * @param {unknown[]} [params=[]]
 * @returns {Promise<T>}
 */
export async function one(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows[0];
}

/**
 * Asserts that a statement fails with the given SQLSTATE.
 *
 * @param {string} code
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<void>}
 */
export async function rejectsWith(code, fn) {
  try {
    await fn();
  } catch (e) {
    const got = e.code;
    if (got === code) return;
    throw new Error(`Expected SQLSTATE ${code}, got ${got}: ${e.message}`);
  }
  throw new Error(`Expected SQLSTATE ${code}, but the statement succeeded`);
}

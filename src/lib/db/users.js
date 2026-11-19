import { query, queryOne } from './postgres';

/**
 * @typedef {object} UserRow
 * @property {number} id
 * @property {string} name
 * @property {string} email
 * @property {'individual' | 'advisor'} role
 * @property {string | null} pan_number
 * @property {number | null} advisor_id
 * @property {string} created_at
 */
/**
 * @typedef {UserRow & { password_hash: string }} UserWithHash
 * @property {string} password_hash
 */

/**
 * @param {string} email
 * @returns {Promise<UserWithHash | null>}
 */
export async function findUserByEmail(email) {
  return queryOne(
    `SELECT id, name, email, password_hash, role, pan_number, advisor_id, created_at
       FROM users
      WHERE email = $1`,
    [email],
  );
}

/**
 * @param {number} id
 * @returns {Promise<UserRow | null>}
 */
export async function findUserById(id) {
  return queryOne(
    `SELECT id, name, email, role, pan_number, advisor_id, created_at
       FROM users
      WHERE id = $1`,
    [id],
  );
}

/**
 * @param {{ name: string, email: string, passwordHash: string, role: 'individual' | 'advisor', panNumber?: string | null }} input
 * @returns {Promise<UserRow>}
 */
export async function createUser(input) {
  const rows = await query(
    `INSERT INTO users (name, email, password_hash, role, pan_number)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, email, role, pan_number, advisor_id, created_at`,
    [input.name, input.email, input.passwordHash, input.role, input.panNumber ?? null],
  );
  return rows[0];
}

/**
 * An advisor may only view clients assigned to them. Every advisor-scoped read
 * funnels through this check rather than trusting the ?userId= query param.
 *
 * @param {number} advisorId
 * @param {number} clientId
 * @returns {Promise<boolean>}
 */
export async function advisorOwnsClient(advisorId, clientId) {
  const row = await queryOne(
    `SELECT EXISTS (
       SELECT 1 FROM users
        WHERE id = $2 AND advisor_id = $1 AND role = 'individual'
     ) AS ok`,
    [advisorId, clientId],
  );
  return row?.ok ?? false;
}

/**
 * Advisor dashboard: clients plus their latest net worth, in one JOIN.
 *
 * @param {number} advisorId
 */
export async function listAdvisorClients(advisorId) {
  return query(
    `SELECT u.id,
            u.name,
            u.email,
            u.created_at,
            COALESCE(s.net_worth, 0)         AS net_worth,
            COALESCE(s.total_assets, 0)      AS total_assets,
            COALESCE(s.total_liabilities, 0) AS total_liabilities
       FROM users u
       -- LATERAL: pick each client's single most recent snapshot without a
       -- correlated subquery per column.
       LEFT JOIN LATERAL (
            SELECT n.net_worth, n.total_assets, n.total_liabilities
              FROM net_worth_snapshots n
             WHERE n.user_id = u.id
             ORDER BY n.snapshot_date DESC
             LIMIT 1
       ) s ON TRUE
      WHERE u.advisor_id = $1
      ORDER BY u.name`,
    [advisorId],
  );
}

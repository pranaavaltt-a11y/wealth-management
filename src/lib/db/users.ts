import { query, queryOne } from './postgres';

export interface UserRow {
  id: number;
  name: string;
  email: string;
  role: 'individual' | 'advisor';
  pan_number: string | null;
  advisor_id: number | null;
  created_at: string;
}
interface UserWithHash extends UserRow { password_hash: string }

export async function findUserByEmail(email: string): Promise<UserWithHash | null> {
  return queryOne<UserWithHash>(
    `SELECT id, name, email, password_hash, role, pan_number, advisor_id, created_at
       FROM users
      WHERE email = $1`,
    [email],
  );
}

export async function findUserById(id: number): Promise<UserRow | null> {
  return queryOne<UserRow>(
    `SELECT id, name, email, role, pan_number, advisor_id, created_at
       FROM users
      WHERE id = $1`,
    [id],
  );
}

export async function createUser(input: {
  name: string;
  email: string;
  passwordHash: string;
  role: 'individual' | 'advisor';
  panNumber?: string | null;
}): Promise<UserRow> {
  const rows = await query<UserRow>(
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
 */
export async function advisorOwnsClient(advisorId: number, clientId: number): Promise<boolean> {
  const row = await queryOne<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM users
        WHERE id = $2 AND advisor_id = $1 AND role = 'individual'
     ) AS ok`,
    [advisorId, clientId],
  );
  return row?.ok ?? false;
}

/** Advisor dashboard: clients plus their latest net worth, in one JOIN. */
export async function listAdvisorClients(advisorId: number) {
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

import { query, queryOne, num } from './postgres';

export interface NetWorthPoint {
  snapshotDate: string;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

function toPoint(r: Record<string, string>): NetWorthPoint {
  return {
    snapshotDate: r.snapshot_date,
    totalAssets: num(r.total_assets),
    totalLiabilities: num(r.total_liabilities),
    netWorth: num(r.net_worth),
  };
}

/** Latest snapshot. Written by the trigger in 004, so this is always a cheap read. */
export async function currentNetWorth(userId: number): Promise<NetWorthPoint | null> {
  const row = await queryOne<Record<string, string>>(
    `SELECT snapshot_date, total_assets, total_liabilities, net_worth
       FROM net_worth_snapshots
      WHERE user_id = $1
      ORDER BY snapshot_date DESC
      LIMIT 1`,
    [userId],
  );
  return row ? toPoint(row) : null;
}

/**
 * Trend series with the month-on-month delta computed in SQL by LAG(), a window
 * function — doing it here rather than in JS keeps the chart component dumb.
 */
export async function netWorthTrend(userId: number, days = 365) {
  const rows = await query<Record<string, string>>(
    `SELECT snapshot_date, total_assets, total_liabilities, net_worth,
            net_worth - LAG(net_worth) OVER (ORDER BY snapshot_date) AS change
       FROM net_worth_snapshots
      WHERE user_id = $1
        AND snapshot_date >= CURRENT_DATE - ($2 || ' days')::INTERVAL
      ORDER BY snapshot_date`,
    [userId, days],
  );
  return rows.map((r) => ({ ...toPoint(r), change: r.change === null ? null : num(r.change) }));
}

/** Forces a recompute — used after bulk operations that bypass row triggers. */
export async function refreshNetWorth(userId: number): Promise<void> {
  await query('SELECT fn_refresh_net_worth($1)', [userId]);
}

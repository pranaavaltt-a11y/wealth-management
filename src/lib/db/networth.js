import { query, queryOne, num } from './postgres';

/**
 * @typedef {object} NetWorthPoint
 * @property {string} snapshotDate
 * @property {number} totalAssets
 * @property {number} totalLiabilities
 * @property {number} netWorth
 */

/**
 * @param {Record<string, string>} r
 * @returns {NetWorthPoint}
 */
function toPoint(r) {
  return {
    snapshotDate: r.snapshot_date,
    totalAssets: num(r.total_assets),
    totalLiabilities: num(r.total_liabilities),
    netWorth: num(r.net_worth),
  };
}

/**
 * Latest snapshot. Written by the trigger in 004, so this is always a cheap read.
 *
 * @param {number} userId
 * @returns {Promise<NetWorthPoint | null>}
 */
export async function currentNetWorth(userId) {
  const row = await queryOne(
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
 *
 * @param {number} userId
 * @param {number} [days=365]
 */
export async function netWorthTrend(userId, days = 365) {
  const rows = await query(
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

/**
 * Forces a recompute — used after bulk operations that bypass row triggers.
 *
 * @param {number} userId
 * @returns {Promise<void>}
 */
export async function refreshNetWorth(userId) {
  await query('SELECT fn_refresh_net_worth($1)', [userId]);
}

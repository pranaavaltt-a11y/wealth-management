import { query, queryOne, num } from './postgres';
import { DEFAULT_LIQUIDITY } from '@/lib/validation/schemas';

/**
 * @typedef {object} AssetRow
 * @property {number} id
 * @property {number} user_id
 * @property {string} name
 * @property {string} asset_type
 * @property {string} purchase_value
 * @property {string} current_value
 * @property {string} purchase_date
 * @property {string} valuation_date
 * @property {string | null} notes
 * @property {'liquid' | 'illiquid'} liquidity
 */

/**
 * @typedef {object} Asset
 * @property {number} id
 * @property {string} name
 * @property {string} assetType
 * @property {number} purchaseValue
 * @property {number} currentValue
 * @property {string} purchaseDate
 * @property {string} valuationDate
 * @property {string | null} notes
 * @property {'liquid' | 'illiquid'} liquidity
 * @property {number} gain
 * @property {number} gainPct
 */

/**
 * @param {AssetRow} r
 * @returns {Asset}
 */
function toAsset(r) {
  const purchase = num(r.purchase_value);
  const current = num(r.current_value);
  return {
    id: r.id,
    name: r.name,
    assetType: r.asset_type,
    purchaseValue: purchase,
    currentValue: current,
    purchaseDate: r.purchase_date,
    valuationDate: r.valuation_date,
    notes: r.notes,
    liquidity: r.liquidity,
    gain: current - purchase,
    gainPct: purchase > 0 ? ((current - purchase) / purchase) * 100 : 0,
  };
}

/**
 * @param {number} userId
 * @returns {Promise<Asset[]>}
 */
export async function listAssets(userId) {
  const rows = await query(
    `SELECT id, user_id, name, asset_type, purchase_value, current_value,
            purchase_date, valuation_date, notes, liquidity
       FROM assets
      WHERE user_id = $1
      ORDER BY current_value DESC, name`,
    [userId],
  );
  return rows.map(toAsset);
}

/**
 * @param {number} userId
 * @param {number} id
 * @returns {Promise<Asset | null>}
 */
export async function getAsset(userId, id) {
  const row = await queryOne(
    `SELECT id, user_id, name, asset_type, purchase_value, current_value,
            purchase_date, valuation_date, notes, liquidity
       FROM assets
      WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return row ? toAsset(row) : null;
}

/**
 * @param {number} userId
 * @param {AssetInput} input
 * @returns {Promise<Asset>}
 */
export async function createAsset(userId, input) {
  const rows = await query(
    `INSERT INTO assets (user_id, name, asset_type, purchase_value, current_value,
                         purchase_date, valuation_date, notes, liquidity)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::date, CURRENT_DATE), $8, $9)
     RETURNING id, user_id, name, asset_type, purchase_value, current_value,
               purchase_date, valuation_date, notes, liquidity`,
    [
      userId,
      input.name,
      input.assetType,
      input.purchaseValue,
      input.currentValue,
      input.purchaseDate,
      input.valuationDate ?? null,
      input.notes || null,
      input.liquidity ?? DEFAULT_LIQUIDITY[input.assetType] ?? 'illiquid',
    ],
  );
  return toAsset(rows[0]);
}

/**
 * @param {number} userId
 * @param {number} id
 * @param {AssetInput} input
 * @returns {Promise<Asset | null>}
 */
export async function updateAsset(userId, id, input) {
  const rows = await query(
    `UPDATE assets
        SET name           = $3,
            asset_type     = $4,
            purchase_value = $5,
            current_value  = $6,
            purchase_date  = $7,
            valuation_date = COALESCE($8::date, CURRENT_DATE),
            notes          = $9,
            liquidity      = $10
      WHERE id = $1 AND user_id = $2
      RETURNING id, user_id, name, asset_type, purchase_value, current_value,
                purchase_date, valuation_date, notes, liquidity`,
    [
      id,
      userId,
      input.name,
      input.assetType,
      input.purchaseValue,
      input.currentValue,
      input.purchaseDate,
      input.valuationDate ?? null,
      input.notes || null,
      input.liquidity ?? DEFAULT_LIQUIDITY[input.assetType] ?? 'illiquid',
    ],
  );
  return rows[0] ? toAsset(rows[0]) : null;
}

/**
 * userId in the WHERE clause is the ownership check — no separate SELECT first.
 *
 * @param {number} userId
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function deleteAsset(userId, id) {
  const rows = await query(`DELETE FROM assets WHERE id = $1 AND user_id = $2 RETURNING id`, [id, userId]);
  return rows.length > 0;
}

/**
 * Allocation chart: GROUP BY with a window function for each slice's share.
 *
 * @param {number} userId
 */
export async function assetAllocation(userId) {
  const rows = await query(
    `SELECT asset_type,
            SUM(current_value)                                        AS total,
            COUNT(*)                                                  AS holdings,
            ROUND(100.0 * SUM(current_value)
                  / NULLIF(SUM(SUM(current_value)) OVER (), 0), 2)    AS pct
       FROM assets
      WHERE user_id = $1
      GROUP BY asset_type
      ORDER BY total DESC`,
    [userId],
  );
  // SUM(SUM(...)) OVER () is the grand total across all groups, computed after
  // aggregation — this is why it needs a window function rather than a subquery.
  return rows.map((r) => ({
    assetType: r.asset_type,
    total: num(r.total),
    holdings: Number(r.holdings),
    pct: num(r.pct),
  }));
}

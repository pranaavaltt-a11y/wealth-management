import { query, queryOne, num } from './postgres';
import type { AssetInput } from '@/lib/validation/schemas';

export interface AssetRow {
  id: number;
  user_id: number;
  name: string;
  asset_type: string;
  purchase_value: string;
  current_value: string;
  purchase_date: string;
  valuation_date: string;
  notes: string | null;
}

export interface Asset {
  id: number;
  name: string;
  assetType: string;
  purchaseValue: number;
  currentValue: number;
  purchaseDate: string;
  valuationDate: string;
  notes: string | null;
  gain: number;
  gainPct: number;
}

function toAsset(r: AssetRow): Asset {
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
    gain: current - purchase,
    gainPct: purchase > 0 ? ((current - purchase) / purchase) * 100 : 0,
  };
}

export async function listAssets(userId: number): Promise<Asset[]> {
  const rows = await query<AssetRow>(
    `SELECT id, user_id, name, asset_type, purchase_value, current_value,
            purchase_date, valuation_date, notes
       FROM assets
      WHERE user_id = $1
      ORDER BY current_value DESC, name`,
    [userId],
  );
  return rows.map(toAsset);
}

export async function getAsset(userId: number, id: number): Promise<Asset | null> {
  const row = await queryOne<AssetRow>(
    `SELECT id, user_id, name, asset_type, purchase_value, current_value,
            purchase_date, valuation_date, notes
       FROM assets
      WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return row ? toAsset(row) : null;
}

export async function createAsset(userId: number, input: AssetInput): Promise<Asset> {
  const rows = await query<AssetRow>(
    `INSERT INTO assets (user_id, name, asset_type, purchase_value, current_value,
                         purchase_date, valuation_date, notes)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::date, CURRENT_DATE), $8)
     RETURNING id, user_id, name, asset_type, purchase_value, current_value,
               purchase_date, valuation_date, notes`,
    [
      userId, input.name, input.assetType, input.purchaseValue, input.currentValue,
      input.purchaseDate, input.valuationDate ?? null, input.notes || null,
    ],
  );
  return toAsset(rows[0]);
}

export async function updateAsset(userId: number, id: number, input: AssetInput): Promise<Asset | null> {
  const rows = await query<AssetRow>(
    `UPDATE assets
        SET name           = $3,
            asset_type     = $4,
            purchase_value = $5,
            current_value  = $6,
            purchase_date  = $7,
            valuation_date = COALESCE($8::date, CURRENT_DATE),
            notes          = $9
      WHERE id = $1 AND user_id = $2
      RETURNING id, user_id, name, asset_type, purchase_value, current_value,
                purchase_date, valuation_date, notes`,
    [
      id, userId, input.name, input.assetType, input.purchaseValue, input.currentValue,
      input.purchaseDate, input.valuationDate ?? null, input.notes || null,
    ],
  );
  return rows[0] ? toAsset(rows[0]) : null;
}

/** userId in the WHERE clause is the ownership check — no separate SELECT first. */
export async function deleteAsset(userId: number, id: number): Promise<boolean> {
  const rows = await query(`DELETE FROM assets WHERE id = $1 AND user_id = $2 RETURNING id`, [id, userId]);
  return rows.length > 0;
}

/** Allocation chart: GROUP BY with a window function for each slice's share. */
export async function assetAllocation(userId: number) {
  const rows = await query<{ asset_type: string; total: string; holdings: string; pct: string }>(
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

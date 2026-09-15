/**
 * A single source of truth for chart colour. Recharts cannot read CSS variables
 * from an SVG `fill`, so the tokens are resolved from the document at runtime
 * and re-resolved when the theme flips.
 *
 * Asset classes and transaction categories are mapped to fixed slots, so
 * "gold" is the same yellow on the pie chart, the table row, and the legend —
 * across both themes.
 */
export const CHART_TOKENS = [
  '--accent', '--info', '--positive', '--warning', '--purple', '--aqua', '--negative', '--fg-muted',
] as const;

export function readToken(token: string, fallback = '#928374'): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return v || fallback;
}

export function chartPalette(): string[] {
  return CHART_TOKENS.map((t) => readToken(t));
}

/** Stable slot per asset type so colours never shuffle between renders. */
const ASSET_SLOT: Record<string, number> = {
  gold: 3, property: 0, equity: 1, mutual_fund: 5, epf: 2, ppf: 4, fd: 6, vehicle: 7, cash: 2, other: 7,
};

export function assetColor(assetType: string): string {
  const palette = chartPalette();
  return palette[ASSET_SLOT[assetType] ?? 7];
}

export function categoryColor(index: number): string {
  const palette = chartPalette();
  return palette[index % palette.length];
}

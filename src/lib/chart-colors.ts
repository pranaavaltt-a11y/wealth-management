'use client';

import { useEffect, useState } from 'react';
import { useTheme } from '@/components/theme-provider';

/**
 * Chart colour, resolved from the same CSS variables the rest of the UI uses,
 * so a category reads identically in the chart, the table and the legend.
 *
 * ---------------------------------------------------------------------------
 * PALETTE VALIDATION
 *
 * The categorical ORDER below is not a taste call. It was searched for
 * exhaustively and measured with the data-viz palette validator in both
 * themes, because a muted palette is exactly where adjacent hues stop being
 * separable:
 *
 *   dark  (surface #262b2e): CVD ΔE 10.1 (deutan), normal-vision ΔE 18.3, contrast PASS
 *   light (surface #fbf9f5): CVD ΔE  9.8 (deutan), normal-vision ΔE 18.3, contrast PASS
 *
 * One check is knowingly not met: the chroma floor. These hues are deliberately
 * desaturated — the calm, low-glare quality *is* the design. Because separation
 * therefore sits around ΔE 10 rather than comfortably above it, SECONDARY
 * ENCODING IS MANDATORY on every chart: a legend is always rendered, segments
 * carry direct labels, and the numbers are always available as a table. Colour
 * is never the only channel.
 *
 * The eighth+ series is NOT a generated hue — it folds into "Other" (grey).
 * ---------------------------------------------------------------------------
 */
export const CATEGORICAL_TOKENS = [
  '--positive',  // sage
  '--purple',    // lilac
  '--accent',    // clay
  '--aqua',      // teal
  '--warning',   // amber
  '--info',      // dusk blue
  '--negative',  // rose
] as const;

/** Reserved slot for the folded "Other" bucket — never a categorical hue. */
export const OTHER_TOKEN = '--fg-faint';

export const MAX_CATEGORIES = CATEGORICAL_TOKENS.length;

export interface ChartColors {
  categorical: string[];
  other: string;
  /** Semantic, used only where the value genuinely has a sign or a state. */
  positive: string;
  negative: string;
  warning: string;
  accent: string;
  info: string;
  grid: string;
  axis: string;
  text: string;
  textMuted: string;
  surface: string;
}

function read(token: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback;
}

function resolve(): ChartColors {
  return {
    categorical: CATEGORICAL_TOKENS.map((t) => read(t, '#928374')),
    other: read(OTHER_TOKEN, '#928374'),
    positive: read('--positive', '#b8bb26'),
    negative: read('--negative', '#fb4934'),
    warning: read('--warning', '#fabd2f'),
    accent: read('--accent', '#fe8019'),
    info: read('--info', '#83a598'),
    grid: read('--line', '#504945'),
    axis: read('--line-strong', '#665c54'),
    text: read('--fg', '#ebdbb2'),
    textMuted: read('--fg-faint', '#928374'),
    surface: read('--bg-raised', '#3c3836'),
  };
}

/**
 * Recharts writes colours straight into SVG attributes, which cannot read CSS
 * variables — so they are resolved to hex here and re-resolved when the theme
 * flips.
 */
export function useChartColors(): ChartColors | null {
  const { theme } = useTheme();
  const [colors, setColors] = useState<ChartColors | null>(null);
  useEffect(() => { setColors(resolve()); }, [theme]);
  return colors;
}

/**
 * Fixed slot per asset class, so a class keeps its colour no matter which
 * classes a particular user happens to hold. Colour follows the entity, never
 * its rank in the current result set.
 */
const ASSET_SLOT: Record<string, number> = {
  property: 2,      // clay  — the largest holding gets the brand hue
  mutual_fund: 5,   // dusk
  gold: 4,          // amber
  equity: 1,        // lilac
  epf: 0,           // sage
  ppf: 6,           // rose
  fd: 3,            // teal
  // cash, vehicle and other fold into the reserved grey slot.
};

export function assetColor(assetType: string, c: ChartColors): string {
  const slot = ASSET_SLOT[assetType];
  return slot === undefined ? c.other : c.categorical[slot];
}

/**
 * Whether a class owns a dedicated hue. Folding to "Other" is decided by this,
 * NOT by rank: if it were rank-based, a class with its own colour could be
 * folded into grey while an unslotted class above it also rendered grey, and
 * two different things would share one colour.
 */
export function hasAssetSlot(assetType: string): boolean {
  return assetType in ASSET_SLOT;
}

/**
 * Validated two-series pairs for the non-categorical charts. Each was checked
 * with the palette validator across both themes using --pairs all, taking the
 * worse of the two modes:
 *
 *   assets / liabilities  dusk↔rose   CVD ΔE 13.2  normal-vision ΔE 18.3  PASS
 *   income / expense      sage↔rose   CVD ΔE  9.9  normal-vision ΔE 20.1  PASS
 *
 * A third line on either chart is still NOT available at this saturation,
 * which is why the net worth series keeps its own panel rather than being
 * overlaid on assets and liabilities.
 */
export const VALIDATED_PAIRS = {
  assetsVsLiabilities: ['info', 'negative'] as const,
  incomeVsExpense: ['positive', 'negative'] as const,
};

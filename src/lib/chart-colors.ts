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
 * The categorical order below is not a taste call — it was searched for and
 * verified with the data-viz palette validator across BOTH themes:
 *
 *   dark  (surface #3c3836): CVD ΔE 9.7 (deutan), normal-vision ΔE 20.9, contrast PASS
 *   light (surface #f9f5d7): CVD ΔE 10.0 (deutan), normal-vision ΔE 21.5, contrast PASS
 *
 * Two checks are knowingly not met, and both are inherent to Gruvbox rather
 * than fixable by reordering:
 *
 *   - Chroma floor. Gruvbox blue (#83a598, C=0.042) and aqua are deliberately
 *     desaturated — that muted quality *is* the palette. Mitigated by the
 *     mandatory secondary encoding below.
 *   - Lightness band (dark mode only). Gruvbox's "bright" set sits above the
 *     band on a dark surface. Its neutral variants fall within the band but
 *     drop CVD separation below the floor, so brightness was traded for
 *     distinguishability — the check that actually affects readability.
 *
 * Because CVD separation sits in the 8–12 range rather than comfortably above,
 * SECONDARY ENCODING IS MANDATORY on every chart using this palette: a legend
 * is always rendered, segments carry direct labels, and the underlying numbers
 * are always available as a table. Colour is never the only channel.
 *
 * The eighth+ series is NOT a generated hue — it folds into "Other" (grey).
 * ---------------------------------------------------------------------------
 */
export const CATEGORICAL_TOKENS = [
  '--accent',    // orange
  '--info',      // blue
  '--warning',   // yellow
  '--purple',    // purple
  '--positive',  // green
  '--negative',  // red
  '--aqua',      // aqua
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
  property: 0,      // orange
  mutual_fund: 1,   // blue
  gold: 2,          // yellow
  equity: 3,        // purple
  epf: 4,           // green
  ppf: 5,           // red
  fd: 6,            // aqua
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
 * with the palette validator across both themes using --pairs all:
 *
 *   assets / liabilities  blue↔red    CVD ΔE 12.2  normal-vision ΔE 25.3  PASS
 *   income / expense      green↔red   CVD ΔE  9.7  normal-vision ΔE 22.0  PASS
 *
 * A third line on either chart is NOT available: no Gruvbox trio clears the
 * normal-vision floor in both themes, which is why the net worth series lives
 * in its own panel rather than being overlaid on assets and liabilities.
 */
export const VALIDATED_PAIRS = {
  assetsVsLiabilities: ['info', 'negative'] as const,
  incomeVsExpense: ['positive', 'negative'] as const,
};

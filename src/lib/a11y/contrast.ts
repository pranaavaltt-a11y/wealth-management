/**
 * WCAG 2.1 colour-contrast maths (issue #24).
 *
 * The whole design system is a set of CSS variables (src/app/globals.css), so
 * accessibility of text and UI colour can be checked directly from those
 * tokens — see tests/unit/accessibility.test.ts, which parses globals.css and
 * asserts every text/background pair clears the relevant threshold in both
 * themes. Keeping the maths here (not in the test) means the app, a script, or
 * a future contrast-aware component can reuse it.
 *
 * Reference: https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */

/** AA thresholds. Large text is ≥18.66px bold or ≥24px regular. */
export const AA_NORMAL = 4.5;
export const AA_LARGE = 3.0;
/** AA for non-text UI (component boundaries, graphical objects, focus rings). */
export const AA_UI = 3.0;

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Parse #rgb or #rrggbb (with or without the leading #). Throws on garbage. */
export function parseHex(hex: string): RGB {
  const h = hex.trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Not a hex colour: "${hex}"`);
  }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** sRGB 0–255 channel → linear-light 0–1. */
function linearise(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance (0 = black, 1 = white) per WCAG. */
export function relativeLuminance(color: string | RGB): number {
  const { r, g, b } = typeof color === 'string' ? parseHex(color) : color;
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/** Contrast ratio between two colours, from 1 (identical) to 21 (black/white). */
export function contrastRatio(a: string | RGB, b: string | RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Rounded to two decimals, the way contrast is usually reported. */
export function ratio(a: string | RGB, b: string | RGB): number {
  return Math.round(contrastRatio(a, b) * 100) / 100;
}

export type ContrastLevel = 'normal' | 'large' | 'ui';

export function threshold(level: ContrastLevel): number {
  return level === 'normal' ? AA_NORMAL : level === 'large' ? AA_LARGE : AA_UI;
}

/** Does this pair meet WCAG AA for the given use? */
export function meetsAA(a: string | RGB, b: string | RGB, level: ContrastLevel = 'normal'): boolean {
  return contrastRatio(a, b) >= threshold(level);
}

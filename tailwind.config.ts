import type { Config } from 'tailwindcss';

/**
 * WealthWise design system.
 * Every colour is exposed as a CSS variable (see src/app/globals.css) so that
 * light/dark mode is a single `data-theme` swap on <html>, and so charts can
 * read the exact same tokens the UI uses.
 */
const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: 'var(--bg)',
          soft: 'var(--bg-soft)',
          raised: 'var(--bg-raised)',
          inset: 'var(--bg-inset)',
        },
        fg: {
          DEFAULT: 'var(--fg)',
          muted: 'var(--fg-muted)',
          faint: 'var(--fg-faint)',
        },
        line: {
          DEFAULT: 'var(--line)',
          strong: 'var(--line-strong)',
        },
        // Semantic utilities (text-/bg-/border-accent, -positive, …) map to the
        // text-grade hues so coloured text clears WCAG AA (#24). The chart fill
        // hues live on --accent/--positive/… and are read straight from CSS by
        // chart-colors.ts, so charts are unaffected. `accent.brand` exposes the
        // fill clay for the few places that want it (e.g. the focus ring).
        accent: {
          DEFAULT: 'var(--accent-text)',
          brand: 'var(--accent)',
          hover: 'var(--accent-hover)',
          fg: 'var(--accent-fg)',
        },
        positive: 'var(--positive-text)',
        negative: 'var(--negative-text)',
        warning: 'var(--warning-text)',
        info: 'var(--info-text)',
        purple: 'var(--purple-text)',
        aqua: 'var(--aqua-text)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: { DEFAULT: '4px', md: '6px', lg: '8px', xl: '12px' },
      boxShadow: { soft: 'var(--shadow-soft)' },
    },
  },
  plugins: [],
};
export default config;

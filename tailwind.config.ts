import type { Config } from 'tailwindcss';

/**
 * ArthaTrack design system — Gruvbox-derived.
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
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          fg: 'var(--accent-fg)',
        },
        positive: 'var(--positive)',
        negative: 'var(--negative)',
        warning: 'var(--warning)',
        info: 'var(--info)',
        purple: 'var(--purple)',
        aqua: 'var(--aqua)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: { DEFAULT: '2px', md: '3px', lg: '4px' },
      boxShadow: { none: 'none' },
    },
  },
  plugins: [],
};
export default config;

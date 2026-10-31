# WealthWise — Accessibility report

> Issue #24 — Accessibility & usability checks. Scope: WCAG 2.1 Level AA, with a
> focus on colour contrast across the light and dark themes. The checks that can
> be, are automated and run in CI as part of the test suite.

## Method

The whole UI is themed from a small set of CSS custom properties in
`src/app/globals.css` (one `data-theme` swap flips light ↔ dark). That makes
colour accessibility checkable directly from the tokens, without screenshotting
every screen:

- `src/lib/a11y/contrast.ts` — WCAG 2.1 relative-luminance and contrast-ratio
  maths (the same formula as the WebAIM checker).
- `tests/unit/accessibility.test.ts` — parses `globals.css`, and asserts every
  text/background and control pair clears its threshold in **both** themes. A
  future token edit that regresses contrast fails the build.

Thresholds used: **4.5:1** for normal text, **3:1** for large text, non-text UI
and graphical objects (WCAG 1.4.3 and 1.4.11).

Run it with:

```bash
npm run test:unit
```

## What was wrong

The seven accent/semantic hues (`--accent`, `--positive`, `--negative`,
`--warning`, `--info`, `--purple`, `--aqua`) were tuned as **chart fills** —
low-glare, and machine-validated for colour-blind separation (see the notes in
`src/lib/chart-colors.ts`). That is the right goal for a bar or a line, but
several of them were then also used as **small coloured text** (`text-positive`
on amounts, `text-accent` on tabs, inline `.field-error`, …), where a fill-grade
hue falls below the 4.5:1 floor. Two more tokens failed outright: the muted
metadata colour `--fg-faint`, and the primary button's label on its clay fill.

Measured on the card surface (`--bg-raised`), before → after:

| Pair | Before | After |
|---|---|---|
| fg-faint (light) | 3.12:1 | 4.99:1 |
| accent text (light) | 4.15:1 | 5.97:1 |
| positive text (light) | 4.09:1 | 5.74:1 |
| warning text (light) | 3.97:1 | 5.70:1 |
| primary button label (light) | 4.15:1 | 5.97:1 |
| fg-faint (dark) | 3.61:1 | 4.71:1 |
| negative text (dark) | 3.98:1 | 5.21:1 |
| purple text (dark) | 4.37:1 | 5.26:1 |
| aqua text (dark) | 4.14:1 | 5.37:1 |

## What changed

**A separate text-grade palette, so charts are left alone.** The fill hues keep
their validated values; a parallel set of `--*-text` tokens holds darker (light
theme) / lighter (dark theme) steps that clear AA. The Tailwind semantic
utilities (`text-`, `bg-`, `border-accent` / `-positive` / …) now resolve to the
text-grade tokens, while `chart-colors.ts` keeps reading the fill tokens
straight from CSS — so the colour-blind-validated chart palette is untouched.

- `--fg-faint` darkened (`#948d82` → `#726b64`) / lightened (`#857f76` →
  `#9a938a`). It stays a visible step below `--fg-muted`, so the
  fg → fg-muted → fg-faint emphasis ladder is preserved (asserted in the tests).
- Primary button now fills with `--accent-text` (deeper clay); its white label
  goes from 4.15:1 to ~6:1. The brand clay `--accent` is still used for the
  focus border and charts.
- `.btn-danger` and `.field-error` use `--negative-text`, fixing the dark theme.

## Verification

All colour checks pass in both themes (`npm run test:unit`):

- 10 text tokens × 2 themes ≥ 4.5:1 on every body surface.
- Primary-button and danger-hover labels ≥ 4.5:1.
- Focus indicator (accent border + 3 px ring) ≥ 3:1.
- Chart fill hues still ≥ 3:1 against the card surface, so the data stays
  visible after the change.

## Beyond contrast (already in place)

- **Keyboard focus is always visible** — `:focus-visible` draws a 3 px `--ring`
  halo plus an accent border on buttons, inputs and selects; the ring itself
  clears 3:1.
- **Colour is never the only channel** — charts always render a legend, direct
  segment labels and an underlying number table (enforced by the chart-palette
  design; see `chart-colors.ts`). Red/green amounts are also signed and
  labelled, not distinguished by hue alone.
- **Tabular numerals** (`.tnum`) keep rupee columns aligned for scannability.
- **Semantic structure** — forms use real `<label>`s, tables use `<thead>`/`th`,
  and the single `data-theme` attribute keeps `color-scheme` correct for native
  controls and scrollbars.

## Known limitation / deliberate trade-off

**Resting control borders (WCAG 1.4.11).** `--line-strong` — the hairline on
inputs, selects and buttons at rest — is ~1.4:1 against the page, below the 3:1
non-text floor. Raising it to 3:1 means a medium-grey border on every control,
which removes the calm, hairline look the design is built around
(`globals.css`: "Data-dense but unhurried: … hairline separators"). We kept the
hairline because each field is still identifiable by other means — a persistent
`<label>`, a fill (`--bg`) distinct from the card, and a **strong focus state**
that does clear 3:1 — so the control is never identified by its resting border
alone. The automated test therefore enforces the focus indicator rather than the
resting border.

If strict 1.4.11 compliance on resting controls is required, the one-line change
is to deepen `--line-strong` to approximately `#928c7c` (light) / `#6f767c`
(dark); both clear 3:1 against the page and card surfaces. This is left as a
product/design decision rather than made unilaterally.

## Not covered here

This pass is colour- and token-focused. A full audit should still add runtime
checks on rendered pages (e.g. `axe-core` against each route), screen-reader
spot-checks, and a `prefers-reduced-motion` media query for the few transitions.
These are recommended follow-ups.

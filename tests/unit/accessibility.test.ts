import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseHex, relativeLuminance, contrastRatio, ratio, meetsAA,
  AA_NORMAL, AA_LARGE, AA_UI,
} from '../../src/lib/a11y/contrast';

// ---------------------------------------------------------------- the maths

describe('contrast maths (WCAG 2.1)', () => {
  it('parses #rgb and #rrggbb', () => {
    assert.deepEqual(parseHex('#fff'), { r: 255, g: 255, b: 255 });
    assert.deepEqual(parseHex('3a3733'), { r: 0x3a, g: 0x37, b: 0x33 });
    assert.throws(() => parseHex('#xyz'), /Not a hex colour/);
  });

  it('puts luminance of black at 0 and white at 1', () => {
    assert.equal(relativeLuminance('#000000'), 0);
    assert.equal(relativeLuminance('#ffffff'), 1);
  });

  it('gives the textbook 21:1 for black on white and is symmetric', () => {
    assert.equal(ratio('#000', '#fff'), 21);
    assert.equal(contrastRatio('#000', '#fff'), contrastRatio('#fff', '#000'));
    assert.equal(ratio('#777', '#777'), 1); // a colour on itself
  });

  it('classifies AA thresholds correctly', () => {
    // #767676 on white is the canonical 4.54:1 boundary case.
    assert.ok(meetsAA('#767676', '#ffffff', 'normal'));
    assert.ok(!meetsAA('#797979', '#ffffff', 'normal'));
    assert.ok(meetsAA('#949494', '#ffffff', 'large')); // passes large, not normal
    assert.ok(!meetsAA('#949494', '#ffffff', 'normal'));
    assert.equal(AA_NORMAL, 4.5);
    assert.equal(AA_LARGE, 3);
    assert.equal(AA_UI, 3);
  });
});

// ------------------------------------------------- the actual design tokens

/** Pull `--token: #hex;` declarations out of one CSS rule block. */
function parseTokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
const LIGHT = parseTokens(css.slice(css.indexOf(':root'), css.indexOf("[data-theme='dark']")));
const DARK = parseTokens(css.slice(css.indexOf("[data-theme='dark']")));
const THEMES: [string, Record<string, string>][] = [['light', LIGHT], ['dark', DARK]];

/** The surfaces body text actually sits on. */
const SURFACES = ['--bg', '--bg-soft', '--bg-raised'];

/** Every token used for text, and the minimum it must clear on any surface. */
const TEXT_TOKENS = [
  '--fg', '--fg-muted', '--fg-faint',
  '--accent-text', '--positive-text', '--negative-text',
  '--warning-text', '--info-text', '--purple-text', '--aqua-text',
];

/** Fill hues read by charts — graphical objects, so WCAG AA is 3:1 (1.4.11). */
const FILL_TOKENS = ['--accent', '--positive', '--negative', '--warning', '--info', '--purple', '--aqua'];

function worstOnSurfaces(tokens: Record<string, string>, token: string): number {
  return Math.min(...SURFACES.map((s) => contrastRatio(tokens[token], tokens[s])));
}

describe('design tokens: text contrast (WCAG AA 4.5:1)', () => {
  for (const [name, tokens] of THEMES) {
    for (const token of TEXT_TOKENS) {
      it(`${name}: ${token} clears 4.5:1 on every surface`, () => {
        const got = worstOnSurfaces(tokens, token);
        assert.ok(got >= AA_NORMAL, `${token} worst ratio ${got.toFixed(2)} < ${AA_NORMAL}`);
      });
    }
  }

  it('keeps the fg → fg-muted → fg-faint emphasis ladder intact', () => {
    for (const [, t] of THEMES) {
      const lum = (x: string) => relativeLuminance(t[x]);
      // In light the ladder gets lighter; in dark it gets darker. Either way the
      // steps must be distinct, not collapsed by the contrast fixes.
      assert.notEqual(lum('--fg'), lum('--fg-muted'));
      assert.notEqual(lum('--fg-muted'), lum('--fg-faint'));
    }
  });
});

describe('design tokens: interactive controls', () => {
  it('primary button label clears 4.5:1 (accent-fg on accent-text)', () => {
    for (const [name, t] of THEMES) {
      const r = ratio(t['--accent-fg'], t['--accent-text']);
      assert.ok(r >= AA_NORMAL, `${name}: button label ${r} < ${AA_NORMAL}`);
    }
  });

  it('danger button hover label clears 4.5:1', () => {
    for (const [name, t] of THEMES) {
      const r = Math.min(ratio(t['--bg'], t['--negative-text']), ratio(t['--bg-raised'], t['--negative-text']));
      assert.ok(r >= AA_NORMAL, `${name}: danger hover label ${r} < ${AA_NORMAL}`);
    }
  });

  it('focus indicator (accent border) clears the 3:1 non-text floor', () => {
    for (const [name, t] of THEMES) {
      const r = worstOnSurfaces(t, '--accent');
      assert.ok(r >= AA_UI, `${name}: focus border ${r} < ${AA_UI}`);
    }
  });
});

describe('design tokens: chart fills stay visible (3:1 graphical)', () => {
  // The contrast fixes must not have made the chart palette itself fail: each
  // fill hue still has to be distinguishable from the surface behind it.
  for (const [name, tokens] of THEMES) {
    for (const token of FILL_TOKENS) {
      it(`${name}: ${token} fill clears 3:1 on card surface`, () => {
        const r = ratio(tokens[token], tokens['--bg-raised']);
        assert.ok(r >= AA_UI, `${token} fill ${r} < ${AA_UI}`);
      });
    }
  }
});

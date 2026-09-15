'use client';

import type { ChartColors } from '@/lib/chart-colors';
import { formatINR } from '@/lib/format';

/**
 * Pieces shared by every chart: the tooltip surface, the legend, and the
 * "no data yet" state. Keeping them here is what makes the charts read as one
 * system rather than three separately-styled widgets.
 */

export function ChartTooltip({ title, rows }: {
  title: string;
  rows: { label: string; value: string; color?: string }[];
}) {
  return (
    <div className="border bg-bg-raised px-2.5 py-2 text-xs" style={{ borderColor: 'var(--line-strong)' }}>
      <div className="tnum mb-1 font-semibold text-fg">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 whitespace-nowrap">
          {r.color && <span className="inline-block h-2 w-2 shrink-0" style={{ background: r.color }} />}
          {/* Label and value wear text tokens, never the series colour — the
              swatch beside them already carries identity. */}
          <span className="text-fg-muted">{r.label}</span>
          <span className="tnum ml-auto pl-3 text-fg">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Always rendered for 2+ series: identity must never be colour alone. */
export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5 text-[11px] text-fg-muted">
          <span className="inline-block h-2 w-2 shrink-0" style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

export function ChartEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-48 items-center justify-center text-sm text-fg-faint">{children}</div>
  );
}

/**
 * Compact axis money labels: ₹1.6Cr, ₹1.9L, ₹55k.
 *
 * Lakhs keep one decimal on purpose: rounding to whole lakhs made ₹1.5L and
 * ₹1.9L both render as "₹2L", so the axis showed the same label twice at
 * different heights.
 */
export function axisMoney(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  // Trailing zeros are dropped, so a round tick reads "₹90L" rather than
  // "₹90.0L", while the decimals that actually disambiguate two ticks stay.
  const trim = (n: number, dp: number) => n.toFixed(dp).replace(/\.?0+$/, '');
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7, 2)}Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5, 1)}L`;
  if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3, 0)}k`;
  return `${sign}₹${abs.toFixed(0)}`;
}

export function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

export const money = (v: number) => formatINR(v, { decimals: false });

/** Recessive axis/grid styling, applied identically across the three charts. */
export function axisProps(c: ChartColors) {
  return {
    stroke: c.axis,
    tick: { fill: c.textMuted, fontSize: 11, fontFamily: 'var(--font-mono)' },
    tickLine: false,
    axisLine: { stroke: c.grid },
  };
}

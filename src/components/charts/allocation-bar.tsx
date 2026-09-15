'use client';

import { useChartColors, assetColor, hasAssetSlot } from '@/lib/chart-colors';
import { Legend, ChartEmpty } from './chart-shell';
import { formatINR, titleCase } from '@/lib/format';

interface Slice { assetType: string; currentValue: number; allocationPct: number; holdings: number }

/**
 * Part-to-whole -> a single horizontal stacked bar, not a pie or donut.
 * With up to ten asset classes and long names ("Mutual Fund"), a donut's
 * adjacent slices become indistinguishable; a sorted horizontal bar keeps the
 * ordering readable and the labels flat.
 *
 * Built as plain flex divs rather than a chart library: it is one stacked row,
 * and hand-rolling it gives exact control over the 2px surface gaps between
 * segments that keep adjacent fills from bleeding together.
 */
export function AllocationBar({ data }: { data: Slice[] }) {
  const c = useChartColors();
  if (!c) return <ChartEmpty>Loading…</ChartEmpty>;
  if (data.length === 0) return <ChartEmpty>No assets recorded yet.</ChartEmpty>;

  // Fold by whether the class owns a dedicated hue, never by rank. Ranking
  // would let a slotted class drop into the grey "Other" bucket while an
  // unslotted class above it rendered grey too — two things, one colour.
  const ranked = [...data].sort((a, b) => b.currentValue - a.currentValue);
  const named = ranked.filter((s) => hasAssetSlot(s.assetType));
  const rest = ranked.filter((s) => !hasAssetSlot(s.assetType));

  const segments = named.map((s) => ({
    label: titleCase(s.assetType),
    value: s.currentValue,
    pct: s.allocationPct,
    color: assetColor(s.assetType, c),
  }));

  if (rest.length > 0) {
    segments.push({
      label: `Other (${rest.length})`,
      value: rest.reduce((sum, r) => sum + r.currentValue, 0),
      pct: rest.reduce((sum, r) => sum + r.allocationPct, 0),
      color: c.other,
    });
  }

  const total = segments.reduce((s, x) => s + x.value, 0);

  return (
    <div>
      <div className="tnum mb-2 text-lg font-semibold">{formatINR(total, { compact: true })}</div>

      <div className="flex h-8 w-full gap-[2px]" role="img"
           aria-label={`Asset allocation: ${segments.map((s) => `${s.label} ${s.pct}%`).join(', ')}`}>
        {segments.map((s) => (
          <div
            key={s.label}
            className="group relative flex items-center justify-center overflow-hidden"
            style={{ width: `${Math.max(s.pct, 0.5)}%`, background: s.color }}
            title={`${s.label} — ${formatINR(s.value, { decimals: false })} (${s.pct}%)`}
          >
            {/* Direct label on segments wide enough to hold one: the mandatory
                secondary encoding, so the chart never relies on hue alone. */}
            {s.pct >= 8 && (
              <span className="tnum px-1 text-[10px] font-semibold" style={{ color: c.surface }}>
                {s.pct.toFixed(0)}%
              </span>
            )}
          </div>
        ))}
      </div>

      <Legend items={segments.map((s) => ({ label: `${s.label} · ${s.pct.toFixed(1)}%`, color: s.color }))} />
    </div>
  );
}

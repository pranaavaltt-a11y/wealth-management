'use client';

import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { useChartColors } from '@/lib/chart-colors';
import { ChartTooltip, Legend, ChartEmpty, axisMoney, monthLabel, money, axisProps } from './chart-shell';
import { formatDate } from '@/lib/format';

interface Point {
  snapshotDate: string;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

/**
 * Change over time, shown as SMALL MULTIPLES rather than one three-line chart.
 *
 * Why: net worth, assets and liabilities on one axis needs three distinguishable
 * hues, and no Gruvbox trio clears the palette validator's normal-vision floor
 * in both themes — orange↔red comes out at ΔE 8.4 in light mode, well under the
 * floor of 15. Splitting into two panels means each panel carries at most two
 * series, and the pair that remains (blue↔red, ΔE 25.3) passes comfortably.
 *
 * Both panels share an x-axis range, so they read as one figure.
 */
export function NetWorthTrend({ data }: { data: Point[] }) {
  const c = useChartColors();
  if (!c) return <ChartEmpty>Loading…</ChartEmpty>;
  if (data.length < 2) return <ChartEmpty>Not enough history yet — snapshots build up daily.</ChartEmpty>;

  const tooltip = (label: unknown, payload: readonly { payload?: unknown }[]) => {
    const row = payload[0]?.payload as Point | undefined;
    if (!row) return null;
    return (
      <ChartTooltip
        title={formatDate(String(label))}
        rows={[
          { label: 'Net worth', value: money(row.netWorth), color: c.accent },
          { label: 'Assets', value: money(row.totalAssets), color: c.info },
          { label: 'Liabilities', value: money(row.totalLiabilities), color: c.negative },
        ]}
      />
    );
  };

  return (
    <div>
      {/* Panel 1 — the headline. A single series needs no legend: the card
          title names it, so colour carries no identity burden at all. */}
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c.accent} stopOpacity={0.22} />
              <stop offset="100%" stopColor={c.accent} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={c.grid} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="snapshotDate" tickFormatter={monthLabel} minTickGap={28} {...axisProps(c)} />
          <YAxis tickFormatter={axisMoney} width={68} {...axisProps(c)} />
          {/* Net worth can legitimately go negative, so zero is marked. */}
          <ReferenceLine y={0} stroke={c.axis} strokeWidth={1} />
          <Tooltip
            cursor={{ stroke: c.axis, strokeWidth: 1 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? tooltip(label, payload) : null}
          />
          <Area
            type="monotone" dataKey="netWorth" stroke={c.accent} strokeWidth={2}
            fill="url(#nwFill)" dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: c.surface }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Panel 2 — what the headline is made of. */}
      <div className="mt-3 border-t pt-2">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-fg-faint">
          Assets vs liabilities
        </div>
        <ResponsiveContainer width="100%" height={130}>
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={c.grid} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="snapshotDate" tickFormatter={monthLabel} minTickGap={28} {...axisProps(c)} />
            <YAxis tickFormatter={axisMoney} width={68} {...axisProps(c)} />
            <Tooltip
              cursor={{ stroke: c.axis, strokeWidth: 1 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? tooltip(label, payload) : null}
            />
            <Line type="monotone" dataKey="totalAssets" stroke={c.info} strokeWidth={1.75}
                  dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: c.surface }}
                  isAnimationActive={false} />
            <Line type="monotone" dataKey="totalLiabilities" stroke={c.negative} strokeWidth={1.75}
                  dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: c.surface }}
                  isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        <Legend items={[
          { label: 'Assets', color: c.info },
          { label: 'Liabilities', color: c.negative },
        ]} />
      </div>
    </div>
  );
}

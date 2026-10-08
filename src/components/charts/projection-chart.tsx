'use client';

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { useChartColors } from '@/lib/chart-colors';
import { ChartTooltip, ChartEmpty, axisMoney, monthLabel, money, axisProps } from './chart-shell';

interface Point { month: string; netWorth: number; scenarioNetWorth: number }

/**
 * Plots the DIFFERENCE between the two scenarios, not the two net worth lines.
 *
 * The first version drew both lines on one axis. On a ₹2 Cr scale a ₹1.5 L gap
 * is under 1% of the axis, so the lines sat on top of each other and the chart
 * said nothing. The question the user is asking is "how much better or worse
 * off would I be, and when?" — so that is what is charted: one series, a zero
 * line, positive above. Both absolute figures stay available in the tooltip.
 *
 * One series, so no legend and no colour-identity burden.
 */
export function ProjectionChart({ data, scenarioLabel }: { data: Point[]; scenarioLabel: string }) {
  const c = useChartColors();
  if (!c) return <ChartEmpty>Loading…</ChartEmpty>;
  if (data.length === 0) return <ChartEmpty>Nothing to project yet.</ChartEmpty>;

  const rows = data.map((p) => ({ ...p, gain: p.scenarioNetWorth - p.netWorth }));
  const final = rows[rows.length - 1].gain;
  const tone = final >= 0 ? c.positive : c.negative;

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="gainFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tone} stopOpacity={0.2} />
            <stop offset="100%" stopColor={tone} stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={c.grid} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="month" tickFormatter={monthLabel} minTickGap={32} {...axisProps(c)} />
        <YAxis tickFormatter={axisMoney} width={68} {...axisProps(c)} />
        <ReferenceLine y={0} stroke={c.axis} strokeWidth={1}
                       label={{ value: 'break-even', position: 'insideTopRight', fill: c.textMuted, fontSize: 10 }} />
        <Tooltip
          cursor={{ stroke: c.axis, strokeWidth: 1 }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as Point & { gain: number };
            return (
              <ChartTooltip title={monthLabel(String(label))} rows={[
                { label: 'Better off by', value: money(p.gain), color: tone },
                { label: 'Keeping the loan', value: money(p.netWorth) },
                { label: scenarioLabel, value: money(p.scenarioNetWorth) },
              ]} />
            );
          }}
        />
        <Area type="monotone" dataKey="gain" stroke={tone} strokeWidth={2} fill="url(#gainFill)"
              dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: c.surface }} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

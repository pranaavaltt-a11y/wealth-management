'use client';

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea } from 'recharts';
import { useChartColors } from '@/lib/chart-colors';
import { ChartTooltip, ChartEmpty, monthLabel, axisProps } from './chart-shell';
import { formatDate } from '@/lib/format';

/**
 * Score over time. A single series, so no legend: the card title names it.
 * The 750+ band is shaded because "is this good?" is the first question anyone
 * asks of a credit-style score, and the band answers it without a lookup.
 */
export function ScoreTrend({ data }: { data: { date: string; score: number }[] }) {
  const c = useChartColors();
  if (!c) return <ChartEmpty>Loading…</ChartEmpty>;
  if (data.length < 2) return <ChartEmpty>Score history builds up as you repay.</ChartEmpty>;

  const min = Math.max(300, Math.floor((Math.min(...data.map((d) => d.score)) - 40) / 50) * 50);

  return (
    <ResponsiveContainer width="100%" height={170}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={c.grid} strokeDasharray="2 4" vertical={false} />
        <ReferenceArea y1={750} y2={900} fill={c.positive} fillOpacity={0.07} />
        <XAxis dataKey="date" tickFormatter={monthLabel} minTickGap={24} {...axisProps(c)} />
        <YAxis domain={[min, 900]} width={40} {...axisProps(c)} />
        <Tooltip
          cursor={{ stroke: c.axis, strokeWidth: 1 }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <ChartTooltip title={formatDate(String(label))}
                            rows={[{ label: 'Score', value: String(payload[0].value), color: c.accent }]} />
            ) : null}
        />
        <Line type="monotone" dataKey="score" stroke={c.accent} strokeWidth={2} dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: c.surface }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

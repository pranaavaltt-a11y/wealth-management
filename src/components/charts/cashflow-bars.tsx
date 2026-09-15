'use client';

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useChartColors } from '@/lib/chart-colors';
import { ChartTooltip, Legend, ChartEmpty, axisMoney, monthLabel, money, axisProps } from './chart-shell';

interface Month { month: string; income: number; expense: number; net: number }

/**
 * Magnitude comparison across two series -> grouped bars on one axis.
 *
 * Income and expense use the semantic positive/negative colours rather than
 * categorical slots, because the two series genuinely carry a sign. The 4px
 * rounded top on each bar is anchored to the baseline, so the bar still reads
 * as sitting on zero.
 */
export function CashflowBars({ data }: { data: Month[] }) {
  const c = useChartColors();
  if (!c) return <ChartEmpty>Loading…</ChartEmpty>;
  if (data.length === 0) return <ChartEmpty>No income or expenses recorded yet.</ChartEmpty>;

  const series = [
    { key: 'income', label: 'Income', color: c.positive },
    { key: 'expense', label: 'Expense', color: c.negative },
  ];

  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
        {/* barGap leaves a 2px surface gap between the paired bars. */}
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid stroke={c.grid} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="month" tickFormatter={monthLabel} minTickGap={16} {...axisProps(c)} />
          <YAxis tickFormatter={axisMoney} width={62} {...axisProps(c)} />
          <Tooltip
            cursor={{ fill: c.grid, fillOpacity: 0.25 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as Month;
              return (
                <ChartTooltip
                  title={monthLabel(String(label))}
                  rows={[
                    ...series.map((s) => ({
                      label: s.label,
                      color: s.color,
                      value: money(Number(row[s.key as 'income' | 'expense'])),
                    })),
                    { label: 'Net', value: money(row.net) },
                  ]}
                />
              );
            }}
          />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} fill={s.color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
    </div>
  );
}

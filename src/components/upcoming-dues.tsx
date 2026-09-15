'use client';

import Link from 'next/link';
import { formatINR, formatDate, titleCase } from '@/lib/format';
import type { UpcomingDue, Urgency } from '@/lib/db/views';
import { Empty } from '@/components/ui';

/**
 * Urgency is bucketed in SQL (v_upcoming_emi_dues), so this component only maps
 * a string to a style. Each band carries a text label as well as a colour.
 */
const URGENCY: Record<Urgency, { label: string; className: string }> = {
  overdue:        { label: 'Overdue',    className: 'text-negative border-negative' },
  due_this_week:  { label: 'This week',  className: 'text-warning border-warning' },
  due_this_month: { label: 'This month', className: 'text-info border-info' },
  upcoming:       { label: 'Upcoming',   className: 'text-fg-muted border-line-strong' },
};

export function UpcomingDues({ dues }: { dues: UpcomingDue[] }) {
  if (dues.length === 0) return <Empty>No EMIs due in the next 45 days.</Empty>;

  const total = dues.reduce((s, d) => s + d.emiAmount, 0);
  const overdue = dues.filter((d) => d.urgency === 'overdue');

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span className="tnum text-fg-muted">
          {dues.length} installment{dues.length === 1 ? '' : 's'} · {formatINR(total)} total
        </span>
        {overdue.length > 0 && (
          <span className="tnum font-semibold text-negative">
            {overdue.length} overdue · {formatINR(overdue.reduce((s, d) => s + d.emiAmount, 0))}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Due</th><th>Lender</th><th className="text-right">#</th>
              <th className="text-right">Amount</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {dues.map((d) => {
              const u = URGENCY[d.urgency];
              return (
                <tr key={d.installmentId}>
                  <td className="tnum whitespace-nowrap text-xs">
                    {formatDate(d.dueDate)}
                    <span className="ml-1.5 text-fg-faint">
                      {d.daysUntilDue < 0
                        ? `${Math.abs(d.daysUntilDue)}d ago`
                        : d.daysUntilDue === 0
                          ? 'today'
                          : `in ${d.daysUntilDue}d`}
                    </span>
                  </td>
                  <td>
                    <Link href={`/loans/${d.loanId}`} className="hover:text-accent">{d.lender}</Link>
                    <span className="ml-1.5 text-[11px] text-fg-faint">{titleCase(d.loanType)}</span>
                  </td>
                  <td className="tnum text-right text-fg-faint">{d.installmentNo}</td>
                  <td className="tnum text-right">{formatINR(d.emiAmount)}</td>
                  <td><span className={`badge ${u.className}`}>{u.label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

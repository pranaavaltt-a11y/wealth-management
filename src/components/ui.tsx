'use client';

import { formatINR } from '@/lib/format';

/** Shared presentational primitives. None of these fetch or compute anything. */

export function Card({ title, action, children, className = '' }: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <header className="card-head">
          <span>{title}</span>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** A headline figure. Monospace, colour-coded by sign when `signed`. */
export function Stat({ label, value, sub, signed = false, compact = false }: {
  label: string;
  value: number;
  sub?: string;
  signed?: boolean;
  compact?: boolean;
}) {
  const tone = !signed ? 'text-fg' : value >= 0 ? 'text-positive' : 'text-negative';
  return (
    <div className="card">
      <div className="text-[11px] font-semibold uppercase tracking-widest text-fg-faint">{label}</div>
      <div className={`tnum mt-1.5 text-2xl font-semibold ${tone}`}>{formatINR(value, { compact })}</div>
      {sub && <div className="mt-1 text-xs text-fg-muted">{sub}</div>}
    </div>
  );
}

const BADGE_TONE: Record<string, string> = {
  active: 'text-info border-info',
  closed: 'text-fg-faint border-line-strong',
  defaulted: 'text-negative border-negative',
  paid: 'text-positive border-positive',
  pending: 'text-fg-muted border-line-strong',
  overdue: 'text-negative border-negative',
  waived: 'text-purple border-purple',
  income: 'text-positive border-positive',
  expense: 'text-negative border-negative',
  asset: 'text-info border-info',
  loan: 'text-warning border-warning',
  fixed: 'text-fg-muted border-line-strong',
  floating: 'text-warning border-warning',
};

export function Badge({ value }: { value: string }) {
  return <span className={`badge ${BADGE_TONE[value] ?? 'text-fg-muted border-line-strong'}`}>{value}</span>;
}

/** Loan payoff / progress bar. Flat fill, no gradient. */
export function Progress({ pct, tone = 'accent' }: { pct: number; tone?: 'accent' | 'positive' }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-1.5 w-full bg-bg-inset">
      <div
        className={tone === 'positive' ? 'h-full bg-positive' : 'h-full bg-accent'}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-fg-faint">{children}</p>;
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="border border-negative px-3 py-2 text-sm text-negative" role="alert">
      {message}
    </p>
  );
}

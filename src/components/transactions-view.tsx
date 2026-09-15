'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client';
import { Card, Empty, ErrorNote, Badge, Stat } from '@/components/ui';
import { formatINR, formatDate, titleCase } from '@/lib/format';
import { TXN_TYPES } from '@/lib/validation/schemas';

interface Txn {
  id: number; txnType: string; amount: number; txnDate: string; category: string;
  description: string | null; source: string;
}

/** Common Indian household categories, offered as a datalist rather than an
 *  enum — users can type anything, and Phase 3 auto-categorisation reuses these. */
const CATEGORIES = [
  'Salary', 'Business Income', 'Rent Received', 'Interest Income', 'Dividend',
  'Groceries', 'Rent Paid', 'Utilities', 'Fuel', 'Transport', 'Dining',
  'Healthcare', 'Education', 'Insurance', 'Shopping', 'Entertainment',
  'EMI Payment', 'Investment', 'Travel', 'Household Help', 'Mobile & Internet',
];

export function TransactionsView({ initial }: { initial: Txn[] }) {
  const router = useRouter();
  const [txns, setTxns] = useState(initial);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const shown = filter === 'all' ? txns : txns.filter((t) => t.txnType === filter);
  const income = txns.filter((t) => t.txnType === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = txns.filter((t) => t.txnType === 'expense').reduce((s, t) => s + t.amount, 0);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = e.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      const { transaction } = await api.post<{ transaction: Txn }>('/api/transactions', payload);
      setTxns((prev) => [transaction, ...prev]);
      form.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the entry.');
    } finally {
      setPending(false);
    }
  }

  async function remove(id: number) {
    try {
      await api.del(`/api/transactions/${id}`);
      setTxns((prev) => prev.filter((t) => t.id !== id));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the entry.');
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Ledger</h1>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Income (shown period)" value={income} compact />
        <Stat label="Expense (shown period)" value={expense} compact />
        <Stat label="Net" value={income - expense} signed compact />
      </div>

      <ErrorNote message={error} />

      <Card title="Record an entry">
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label className="label" htmlFor="t-type">Type</label>
            <select id="t-type" name="txnType" className="select" defaultValue="expense">
              {TXN_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="t-amount">Amount (₹)</label>
            <input id="t-amount" name="amount" type="number" step="0.01" min="0.01" required className="input tnum" />
          </div>
          <div>
            <label className="label" htmlFor="t-date">Date</label>
            <input id="t-date" name="txnDate" type="date" required className="input tnum"
                   defaultValue={new Date().toISOString().slice(0, 10)} />
          </div>
          <div>
            <label className="label" htmlFor="t-cat">Category</label>
            <input id="t-cat" name="category" list="categories" required className="input" defaultValue="Groceries" />
            <datalist id="categories">
              {CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div className="sm:col-span-2 lg:col-span-1">
            <label className="label" htmlFor="t-desc">Description</label>
            <input id="t-desc" name="description" className="input" placeholder="optional" />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={pending} className="btn btn-primary w-full">
              {pending ? 'Saving…' : 'Add entry'}
            </button>
          </div>
        </form>
      </Card>

      <Card
        title={`Entries (${shown.length})`}
        action={
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
                  className="select w-auto py-0.5 text-xs normal-case">
            <option value="all">All types</option>
            {TXN_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </select>
        }
      >
        {shown.length === 0 ? (
          <Empty>Nothing recorded yet.</Empty>
        ) : (
          <div className="max-h-[36rem] overflow-auto">
            <table className="table">
              <thead className="sticky top-0 bg-bg-raised">
                <tr>
                  <th>Date</th><th>Type</th><th>Category</th><th>Description</th>
                  <th>Source</th><th className="text-right">Amount</th><th />
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.id}>
                    <td className="tnum whitespace-nowrap text-xs">{formatDate(t.txnDate)}</td>
                    <td><Badge value={t.txnType} /></td>
                    <td>{t.category}</td>
                    <td className="text-xs text-fg-muted">{t.description ?? '—'}</td>
                    <td className="text-xs text-fg-faint">{t.source}</td>
                    <td className={`tnum text-right ${t.txnType === 'income' ? 'text-positive' : 'text-negative'}`}>
                      {t.txnType === 'income' ? '+' : '−'}{formatINR(t.amount)}
                    </td>
                    <td className="text-right">
                      <button onClick={() => remove(t.id)} className="btn btn-danger px-2 py-0.5 text-xs">Del</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

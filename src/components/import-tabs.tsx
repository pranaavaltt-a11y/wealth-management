'use client';

import { useState } from 'react';
import { ImportView } from '@/components/import-view';
import { ReceiptScan } from '@/components/receipt-scan';

/** Two ways transactions arrive without being typed in: a statement, or a receipt. */
export function ImportTabs() {
  const [tab, setTab] = useState<'statement' | 'receipt'>('statement');
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b">
        {([['statement', 'Bank statement (CSV)'], ['receipt', 'Receipt (photo)']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                    tab === k ? 'border-accent text-accent' : 'border-transparent text-fg-muted hover:text-fg'
                  }`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'statement' ? <ImportView /> : <ReceiptScan />}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client';
import { formatDate } from '@/lib/format';

interface Note { id: number; kind: string; title: string; body: string; dueDate: string | null; isRead: boolean; createdAt: string }

const TONE: Record<string, string> = {
  emi_overdue: 'text-negative', emi_due: 'text-warning', score_change: 'text-info',
};

/**
 * In-app reminders. Opening the list calls the API, which generates any new
 * EMI reminders first — reminders stay current without a background job.
 */
export function NotificationBell() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ notifications: Note[]; unread: number }>('/api/notifications');
      setNotes(r.notifications); setUnread(r.unread);
    } catch { /* the bell is non-essential; stay quiet */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  async function markAll() {
    await api.post('/api/notifications', {});
    await load();
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => { setOpen((o) => !o); if (!open) void load(); }}
              className="btn relative px-2 py-1" aria-label={`Notifications, ${unread} unread`}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="tnum absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-[18px] text-accent-fg">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border bg-bg-raised shadow-soft">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-faint">Reminders</span>
            {unread > 0 && <button onClick={markAll} className="text-xs text-accent">Mark all read</button>}
          </div>
          <ul className="max-h-96 overflow-auto">
            {notes.length === 0 && <li className="px-3 py-6 text-center text-sm text-fg-faint">Nothing due. All clear.</li>}
            {notes.map((n) => (
              <li key={n.id} className={`border-b px-3 py-2.5 last:border-0 ${n.isRead ? 'opacity-55' : ''}`}>
                <div className={`text-sm font-medium ${TONE[n.kind] ?? ''}`}>{n.title}</div>
                <div className="mt-0.5 text-xs text-fg-muted">{n.body}</div>
                <div className="tnum mt-1 text-[10px] text-fg-faint">{formatDate(n.createdAt)}</div>
              </li>
            ))}
          </ul>
          <div className="border-t px-3 py-2 text-[10px] text-fg-faint">
            In-app only. Email or SMS delivery would need a provider and is not connected.
          </div>
        </div>
      )}
    </div>
  );
}

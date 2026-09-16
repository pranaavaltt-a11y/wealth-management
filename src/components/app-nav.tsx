'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ThemeToggle } from '@/components/theme-provider';
import { api } from '@/lib/client';

const LINKS = [
  { href: '/dashboard',    label: 'Dashboard' },
  { href: '/assets',       label: 'Assets' },
  { href: '/loans',        label: 'Loans' },
  { href: '/transactions', label: 'Ledger' },
  { href: '/import',       label: 'Import' },
  { href: '/vault',        label: 'Vault' },
];

export function AppNav({ user }: { user: { name: string; role: string } }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await api.post('/api/auth/logout');
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="border-b bg-bg-soft">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
        <Link href="/dashboard" className="tnum text-lg font-bold text-accent">
          WealthWise
        </Link>

        <nav className="flex items-center gap-1">
          {LINKS.map((l) => {
            const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`border px-2.5 py-1 text-sm transition-colors ${
                  active
                    ? 'border-accent text-accent'
                    : 'border-transparent text-fg-muted hover:border-line hover:text-fg'
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-fg-muted sm:inline">
            {user.name}
            {user.role === 'advisor' && <span className="ml-1.5 badge border-purple text-purple">advisor</span>}
          </span>
          <ThemeToggle />
          <button onClick={logout} className="btn px-2 py-1 text-xs">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}

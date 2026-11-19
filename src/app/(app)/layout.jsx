import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { AppNav } from '@/components/app-nav';

/**
 * Every route in the (app) group is behind this server-side check, so an
 * unauthenticated request never even renders the page shell.
 *
 * @param {{ children: React.ReactNode }} props
 */
export default async function AppLayout({ children }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-screen">
      <AppNav user={user} />
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}

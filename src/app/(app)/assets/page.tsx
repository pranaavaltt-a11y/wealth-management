import { requireUser } from '@/lib/auth/session';
import { listAssets } from '@/lib/db/assets';
import { AssetsView } from '@/components/assets-view';

export const dynamic = 'force-dynamic';

/** Server component: fetches once via the data layer, then hands off to the client view. */
export default async function AssetsPage() {
  const user = await requireUser();
  return <AssetsView initial={await listAssets(user.id)} />;
}

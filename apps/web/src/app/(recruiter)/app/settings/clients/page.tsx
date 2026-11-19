import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { openJobsByClient } from '@/features/clients/domain/clients.ts';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { requireScreen } from '@/features/shell/services/request.ts';
import { getJobs } from '@/server/jobs';
import { getWorkspaces, inActiveWorkspace } from '@/server/workspace';
import { ClientsClient } from './ClientsClient.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations(defaultLocale, defaultTimeZone))('clients.title') };
}

// Settings > Clients (AIV-P1-056): agencies only; an in-house team has no clients, so the page does not exist for it.
export default async function ClientsPage() {
  await requireScreen('settings');
  const result = await inActiveWorkspace(async (ctx) => {
    if ((await getWorkspaces().getWorkspace(ctx))?.type !== 'agency') return null;
    // listClients authorises client.manage: admins and recruiters; anyone else gets the 403 page.
    const clients = await getWorkspaces().listClients(ctx);
    const open = openJobsByClient(await getJobs().listJobs(ctx));
    return clients.map((c) => ({ id: c.id, name: c.name, openJobs: open.get(c.id) ?? 0, archived: !!c.archivedAt }));
  });
  if (!result?.value) notFound();
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader
        breadcrumb={
          <nav aria-label={t('clients.breadcrumb')} className="text-meta text-text-2">
            <Link href="/app/settings" className="underline underline-offset-2 hover:text-text">
              {t('shell.nav.settings')}
            </Link>
          </nav>
        }
        title={t('clients.title')}
      />
      <p className="-mt-3 mb-6 max-w-prose text-body text-text-2">{t('clients.intro')}</p>
      <ClientsClient rows={result.value} />
    </>
  );
}

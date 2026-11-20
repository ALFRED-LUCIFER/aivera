import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import { ForbiddenError, type Action, type WorkspaceContext } from '@aivera/workspaces';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { requireScreen } from '@/features/shell/services/request.ts';
import { getWorkspaces, inActiveWorkspace } from '@/server/workspace';
import { screenMetadata } from '../../Placeholder.tsx';
import { SettingsClient } from './SettingsClient.tsx';

export const generateMetadata = screenMetadata('settings');

/** The module's own rule for an action, so the page cannot drift from it. */
const allows = (ctx: WorkspaceContext, action: Action) =>
  getWorkspaces()
    .authorize(ctx, action)
    .then(
      () => true,
      (error: unknown) => {
        if (error instanceof ForbiddenError) return false;
        throw error;
      },
    );

// Every member who can open the screen reads; only an admin saves, and the server action re-checks (AIV-P1-052).
export default async function SettingsPage() {
  await requireScreen('settings');
  const result = await inActiveWorkspace(async (ctx) => ({
    settings: await getWorkspaces().getSettings(ctx),
    // AIV-P1-056: only an agency has clients, so only it gets the Clients entry.
    agency: (await getWorkspaces().getWorkspace(ctx))?.type === 'agency',
    canEdit: await allows(ctx, 'workspace.settings'),
    // AIV-P1-003: the Members link follows the module's own rule for managing members.
    members: await allows(ctx, 'member.invite'),
  }));
  if (!result) notFound();
  const { agency, members, ...form } = result.value;
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader title={t('shell.nav.settings')} />
      <p className="-mt-3 mb-6 max-w-prose text-body text-text-2">{t('settings.intro')}</p>
      {(agency || members) && (
        <nav aria-label={t('settings.sections')} className="mb-6 flex gap-4">
          {members && (
            <Link href="/app/settings/members" className="font-semibold text-text underline underline-offset-2">
              {t('settings.membersLink')}
            </Link>
          )}
          {agency && (
            <Link href="/app/settings/clients" className="font-semibold text-text underline underline-offset-2">
              {t('settings.clientsLink')}
            </Link>
          )}
        </nav>
      )}
      <SettingsClient {...form} />
    </>
  );
}

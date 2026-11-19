import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import { ForbiddenError } from '@aivera/workspaces';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { requireScreen } from '@/features/shell/services/request.ts';
import { getWorkspaces, inActiveWorkspace } from '@/server/workspace';
import { screenMetadata } from '../Placeholder.tsx';
import { SettingsClient } from './SettingsClient.tsx';

export const generateMetadata = screenMetadata('settings');

// Every member who can open the screen reads; only an admin saves, and the server action re-checks (AIV-P1-052).
export default async function SettingsPage() {
  await requireScreen('settings');
  const result = await inActiveWorkspace(async (ctx) => ({
    settings: await getWorkspaces().getSettings(ctx),
    // The module's own rule for saving, so the page cannot drift from it.
    canEdit: await getWorkspaces()
      .authorize(ctx, 'workspace.settings')
      .then(
        () => true,
        (error: unknown) => {
          if (error instanceof ForbiddenError) return false;
          throw error;
        },
      ),
  }));
  if (!result) notFound();
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader title={t('shell.nav.settings')} />
      <p className="-mt-3 mb-6 max-w-prose text-body text-text-2">{t('settings.intro')}</p>
      <SettingsClient {...result.value} />
    </>
  );
}

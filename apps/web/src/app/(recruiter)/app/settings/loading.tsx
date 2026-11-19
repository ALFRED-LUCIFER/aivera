import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import { SettingsForm } from '@/features/settings/components/SettingsForm.tsx';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

export default async function SettingsLoading() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader title={t('shell.nav.settings')} />
      <p className="-mt-3 mb-6 max-w-prose text-body text-text-2">{t('settings.intro')}</p>
      <SettingsForm view="loading" canEdit />
    </>
  );
}

import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import type { Metadata } from 'next';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import type { ScreenId } from '@/features/shell/domain/navigation.ts';
import { requireScreen } from '@/features/shell/services/request.ts';

/** The page title is the section name; the /app layout's template adds "· Credalent". */
export const screenMetadata = (screen: ScreenId) => async (): Promise<Metadata> => ({
  title: (await getTranslations(defaultLocale, defaultTimeZone))(`shell.nav.${screen}`),
});

// shortcut: the sidebar sections exist before their screens; each screen ticket replaces its page with the real one.
export async function Placeholder({ screen }: { screen: ScreenId }) {
  await requireScreen(screen);
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader title={t(`shell.nav.${screen}`)} />
      <p className="text-text-2">{t('shell.placeholder')}</p>
    </>
  );
}

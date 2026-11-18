import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import type { ScreenId } from '@/features/shell/domain/navigation.ts';
import { requireScreen } from '@/features/shell/services/request.ts';

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

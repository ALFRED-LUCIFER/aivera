import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';

// shortcut: a stage before its screen ships says why it is empty; AIV-P1-034 (ranking), AIV-P2-002 (interviews) and
// AIV-P2-011 (decision pack) replace these pages.
export async function EmptyStage({ page }: { page: 'candidates' | 'interviews' | 'pack' }) {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return <p className="text-body text-text-2">{t(`jobHeader.empty.${page}`)}</p>;
}

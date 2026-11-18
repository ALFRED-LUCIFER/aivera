import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';

// shortcut: the frame exists before the home page; AIV-P3-003 replaces this with search and new jobs.
export default async function CandidateHome() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <h1 className="font-display text-title tracking-tight">{t('candidate.shell.homeTitle')}</h1>
      <p className="mt-2 text-text-2">{t('candidate.shell.placeholder')}</p>
    </>
  );
}

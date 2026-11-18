import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import { notFound } from 'next/navigation';
import { sitePages } from '@/features/candidate-shell/domain/links.ts';

// shortcut: the header and footer link pages that do not exist yet; each page's ticket adds its own route, which
// Next.js matches before this catch-all. Delete this file when the last one lands.
export default async function CandidatePlaceholder({ params }: PageProps<'/candidates/[...section]'>) {
  const { section } = await params;
  const key = sitePages.get(`/candidates/${section.join('/')}`);
  if (!key) notFound();
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <h1 className="font-display text-title tracking-tight">{t(`candidate.shell.${key}`)}</h1>
      <p className="mt-2 text-text-2">{t('candidate.shell.placeholder')}</p>
    </>
  );
}

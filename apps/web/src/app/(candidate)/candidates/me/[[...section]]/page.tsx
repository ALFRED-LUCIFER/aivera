import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

// Serves /candidates/me and every path under it, so ../layout.tsx (the server-side candidate session check) wraps them
// all; deeper paths are 404.
// shortcut: My applications is a placeholder until its CDash ticket; deeper pages arrive with their own tickets.
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations(defaultLocale, defaultTimeZone))('candidate.shell.myApplications') };
}

export default async function MyApplications({ params }: PageProps<'/candidates/me/[[...section]]'>) {
  if ((await params).section) notFound();
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <h1 className="font-display text-title tracking-tight">{t('candidate.shell.myApplications')}</h1>
      <p className="mt-2 text-text-2">{t('candidate.shell.placeholder')}</p>
    </>
  );
}

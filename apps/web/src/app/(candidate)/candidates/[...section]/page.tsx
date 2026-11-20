import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { placeholderKey } from '@/features/candidate-shell/domain/links.ts';

// shortcut: the header and footer link pages that do not exist yet; each page's ticket adds its own route, which
// Next.js matches before this catch-all. Delete this file when the last one lands.
type Props = PageProps<'/candidates/[...section]'>;
const pageKey = async ({ params }: Props) => placeholderKey(`/candidates/${(await params).section.join('/')}`);

// Each placeholder is titled after its page ("Plans · Credalent for candidates", WCAG 2.4.2).
export async function generateMetadata(props: Props): Promise<Metadata> {
  const key = await pageKey(props);
  return key ? { title: (await getTranslations(defaultLocale, defaultTimeZone))(`candidate.shell.${key}`) } : {};
}

export default async function CandidatePlaceholder(props: Props) {
  const key = await pageKey(props);
  if (!key) notFound();
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <h1 className="font-display text-title tracking-tight">{t(`candidate.shell.${key}`)}</h1>
      <p className="mt-2 text-text-2">{t('candidate.shell.placeholder')}</p>
    </>
  );
}

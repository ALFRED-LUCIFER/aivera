import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import type { Metadata } from 'next';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { platformOperator } from '@/server/operator';

export async function generateMetadata(): Promise<Metadata> {
  await platformOperator();
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return { title: t('ops.title') };
}

export default async function OpsHomePage() {
  await platformOperator();
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader title={t('ops.title')} description={t('ops.signedIn')} />
    </>
  );
}

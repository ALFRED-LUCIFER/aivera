import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import type { Metadata } from 'next';
import { Catalogue } from '@/features/ops/components/Catalogue.tsx';
import { catalogueView } from '@/features/ops/domain/catalogue.ts';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { platformOperator } from '@/server/operator';

export async function generateMetadata(): Promise<Metadata> {
  await platformOperator();
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return { title: t('ops.catalogue.title') };
}

// The job types and domain packs, read-only (AIV-P5-015). From the jobs contracts (code, reviewed in PRs): no table.
export default async function CataloguePage() {
  await platformOperator();
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader title={t('ops.catalogue.title')} description={t('ops.catalogue.description')} />
      <Catalogue view={catalogueView()} />
    </>
  );
}

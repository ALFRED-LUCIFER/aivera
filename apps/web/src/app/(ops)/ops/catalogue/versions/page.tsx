import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CatalogueVersions } from '@/features/ops/components/CatalogueVersions.tsx';
import { historyPage, historyPageCount } from '@/features/ops/domain/catalogueHistory.ts';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { listCatalogueVersions, platformOperator } from '@/server/operator';

export async function generateMetadata(): Promise<Metadata> {
  await platformOperator();
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return { title: t('ops.catalogue.history.title') };
}

// The catalogue version history (AIV-P2-050, ADR-013 point 13), read-only. Loading and error: loading.tsx and
// error.tsx beside this page. A malformed page number or one past the last page is a 404.
export default async function CatalogueVersionsPage({ searchParams }: PageProps<'/ops/catalogue/versions'>) {
  await platformOperator();
  const page = historyPage((await searchParams)['page']);
  if (page === null) notFound();
  const [t, { total, rows }] = await Promise.all([
    getTranslations(defaultLocale, defaultTimeZone),
    listCatalogueVersions(page),
  ]);
  const pageCount = historyPageCount(total);
  if (page > pageCount) notFound();
  return (
    <>
      <PageHeader
        breadcrumb={
          <nav aria-label={t('ops.workspaces.detail.breadcrumb')} className="text-meta text-text-2">
            <Link href="/ops/catalogue" className="underline underline-offset-2 hover:text-text">
              {t('ops.catalogue.title')}
            </Link>
          </nav>
        }
        title={t('ops.catalogue.history.title')}
        description={t('ops.catalogue.history.description')}
      />
      <CatalogueVersions rows={rows} page={page} pageCount={pageCount} />
    </>
  );
}

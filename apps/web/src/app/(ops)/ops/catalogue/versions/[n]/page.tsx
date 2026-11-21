import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Catalogue } from '@/features/ops/components/Catalogue.tsx';
import { CatalogueVersionDetail } from '@/features/ops/components/CatalogueVersionDetail.tsx';
import { catalogueView } from '@/features/ops/domain/catalogue.ts';
import { versionNumber } from '@/features/ops/domain/catalogueHistory.ts';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { getCatalogueVersion, platformOperator } from '@/server/operator';

export async function generateMetadata(): Promise<Metadata> {
  await platformOperator();
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return { title: t('ops.catalogue.history.title') };
}

// One published catalogue version, read-only, with its diff against the version before (AIV-P2-050). Anything that is
// not a published version number (a draft's included) is a 404: not-found.tsx beside this page.
export default async function CatalogueVersionPage({ params }: PageProps<'/ops/catalogue/versions/[n]'>) {
  await platformOperator();
  const n = versionNumber((await params).n);
  const detail = n === null ? null : await getCatalogueVersion(n);
  if (!detail) notFound();
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader
        breadcrumb={
          <nav aria-label={t('ops.workspaces.detail.breadcrumb')} className="text-meta text-text-2">
            <Link href="/ops/catalogue/versions" className="underline underline-offset-2 hover:text-text">
              {t('ops.catalogue.history.title')}
            </Link>
          </nav>
        }
        title={t('ops.catalogue.history.detailTitle', { version: detail.summary.version })}
      />
      <CatalogueVersionDetail summary={detail.summary} changes={detail.changes}>
        <Catalogue view={catalogueView(detail.version)} />
      </CatalogueVersionDetail>
    </>
  );
}

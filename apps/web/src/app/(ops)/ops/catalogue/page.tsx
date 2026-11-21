import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { buttonClassName } from '@credalent/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Catalogue } from '@/features/ops/components/Catalogue.tsx';
import { catalogueView } from '@/features/ops/domain/catalogue.ts';
import { draftModel } from '@/features/ops/domain/catalogueEditor.ts';
import { evalView } from '@/features/ops/domain/catalogueEval.ts';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { catalogueDraftEval, catalogueEditorView, platformOperator } from '@/server/operator';
import { CatalogueEditorClient, StartDraftClient } from './CatalogueEditorClient.tsx';

export async function generateMetadata(): Promise<Metadata> {
  await platformOperator();
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return { title: t('ops.catalogue.title') };
}

// The catalogue (ADR-013): with no draft, the published version read-only and "Start a draft"; with one, the editor
// (AIV-P2-045). Loading and error: loading.tsx and error.tsx beside this page.
export default async function CataloguePage() {
  await platformOperator();
  const [t, view, draftEval] = await Promise.all([
    getTranslations(defaultLocale, defaultTimeZone),
    catalogueEditorView(),
    catalogueDraftEval(),
  ]);
  const draft = draftModel(view);
  // Its own snapshot: a draft opened after the editor read has no eval yet. Publish re-checks it (AIV-P2-049).
  const evaluation = evalView(draftEval) ?? { status: 'not_run' as const };
  return (
    <>
      <PageHeader
        title={t('ops.catalogue.title')}
        description={t('ops.catalogue.description')}
        actions={
          <Link href="/ops/catalogue/versions" className={buttonClassName('secondary')}>
            {t('ops.catalogue.historyLink')}
          </Link>
        }
      />
      {draft ? (
        <CatalogueEditorClient publishedVersion={view.published.version} draft={draft} evalView={evaluation} />
      ) : (
        <div className="flex flex-col gap-6">
          <StartDraftClient version={view.published.version} />
          <Catalogue view={catalogueView(view.published)} />
        </div>
      )}
    </>
  );
}

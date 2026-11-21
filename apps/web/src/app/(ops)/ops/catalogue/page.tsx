import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import type { Metadata } from 'next';
import { Catalogue } from '@/features/ops/components/Catalogue.tsx';
import { catalogueView } from '@/features/ops/domain/catalogue.ts';
import { draftModel } from '@/features/ops/domain/catalogueEditor.ts';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { catalogueEditorView, platformOperator } from '@/server/operator';
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
  const [t, view] = await Promise.all([getTranslations(defaultLocale, defaultTimeZone), catalogueEditorView()]);
  const draft = draftModel(view);
  return (
    <>
      <PageHeader title={t('ops.catalogue.title')} description={t('ops.catalogue.description')} />
      {draft ? (
        <CatalogueEditorClient publishedVersion={view.published.version} draft={draft} />
      ) : (
        <div className="flex flex-col gap-6">
          <StartDraftClient version={view.published.version} />
          <Catalogue view={catalogueView(view.published)} />
        </div>
      )}
    </>
  );
}

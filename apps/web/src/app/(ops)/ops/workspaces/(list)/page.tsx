import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import type { Metadata } from 'next';
import { searchWorkspaces } from '@/features/ops/services/searchWorkspaces.ts';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { platformOperator } from '@/server/operator';
import { WorkspacesClient } from './WorkspacesClient.tsx';

export async function generateMetadata(): Promise<Metadata> {
  await platformOperator();
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return { title: t('ops.workspaces.title') };
}

// The workspaces list (AIV-P2-036, ADR-012). Loading and error states: loading.tsx and error.tsx beside this page,
// inside the (list) group so the detail page keeps its own ([id]/error.tsx).
export default async function WorkspacesPage() {
  await platformOperator();
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader title={t('ops.workspaces.title')} description={t('ops.workspaces.description')} />
      <WorkspacesClient initial={await searchWorkspaces({ query: '', page: 1 })} />
    </>
  );
}

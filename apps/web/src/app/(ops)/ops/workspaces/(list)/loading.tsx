import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { WorkspacesList } from '@/features/ops/components/WorkspacesList.tsx';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

// Shown inside the layout, which has already checked the policy; it holds no workspace data.
export default async function WorkspacesLoading() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader title={t('ops.workspaces.title')} />
      <WorkspacesList table={{ status: 'loading' }} />
    </>
  );
}

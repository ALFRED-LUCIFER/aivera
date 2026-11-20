import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { WorkspaceTags } from '@/features/ops/components/WorkspaceBadges.tsx';
import { WorkspaceDetail } from '@/features/ops/components/WorkspaceDetail.tsx';
import { nextChange } from '@/features/ops/domain/workspaces.ts';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { getAudit, getWorkspaceFacts, listOperatorActions, platformOperator } from '@/server/operator';
import { AiBudgetClient } from './AiBudgetClient.tsx';
import { StatusChangeClient } from '../../StatusChangeClient.tsx';

export async function generateMetadata(): Promise<Metadata> {
  await platformOperator();
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return { title: t('ops.workspaces.title') };
}

// A workspace's platform facts (AIV-P2-036, ADR-012). The id is opaque; anything that is not a workspace is a 404.
export default async function WorkspacePage({ params }: PageProps<'/ops/workspaces/[id]'>) {
  const { userId } = await platformOperator();
  const id = z.uuid().safeParse((await params).id);
  const workspace = id.success ? await getWorkspaceFacts(id.data) : null;
  if (!workspace) notFound();
  // Recorded on the server before the page renders (ADR-012 point 8), so every view of a workspace is in the log.
  await getAudit().recordPlatform({
    actorId: userId,
    action: 'ops.workspace_viewed',
    subject: { type: 'workspace', id: workspace.id },
  });
  const change = nextChange(workspace.status);
  const [t, history] = await Promise.all([
    getTranslations(defaultLocale, defaultTimeZone),
    listOperatorActions(workspace.id),
  ]);
  return (
    <>
      <PageHeader
        breadcrumb={
          <nav aria-label={t('ops.workspaces.detail.breadcrumb')} className="text-meta text-text-2">
            <Link href="/ops/workspaces" className="underline underline-offset-2 hover:text-text">
              {t('ops.workspaces.title')}
            </Link>
          </nav>
        }
        title={workspace.name}
        description={<WorkspaceTags workspace={workspace} />}
        actions={
          change && <StatusChangeClient workspace={{ id: workspace.id, name: workspace.name }} change={change} />
        }
      />
      <WorkspaceDetail workspace={workspace} history={history}>
        <AiBudgetClient workspaceId={workspace.id} ai={workspace.ai} />
      </WorkspaceDetail>
    </>
  );
}

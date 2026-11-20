import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import type { Metadata } from 'next';
import { ApprovalsList } from '@/features/ops/components/ApprovalsList.tsx';
import { daysWaiting } from '@/features/ops/domain/workspaces.ts';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { approvalRequired, listPendingApprovals, platformOperator } from '@/server/operator';
import { StatusChangeClient } from '../StatusChangeClient.tsx';
import { ApprovalModeClient } from './ApprovalModeClient.tsx';

export async function generateMetadata(): Promise<Metadata> {
  await platformOperator();
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return { title: t('ops.approvals.title') };
}

// Approve or reject new workspaces while the pilot runs (AIV-P2-039, ADR-012). Loading and error: loading.tsx and
// error.tsx beside this page.
export default async function ApprovalsPage() {
  await platformOperator();
  const [t, required, pending] = await Promise.all([
    getTranslations(defaultLocale, defaultTimeZone),
    approvalRequired(),
    listPendingApprovals(),
  ]);
  const now = new Date();
  return (
    <>
      <PageHeader title={t('ops.approvals.title')} description={t('ops.approvals.description')} />
      <div className="flex flex-col gap-6">
        <ApprovalModeClient required={required} />
        <ApprovalsList
          rows={pending.map((row) => ({
            ...row,
            waitingDays: daysWaiting(row.createdAt, now),
            decide: (
              <>
                <StatusChangeClient workspace={row} change="approve" />
                <StatusChangeClient workspace={row} change="reject" />
              </>
            ),
          }))}
        />
      </div>
    </>
  );
}

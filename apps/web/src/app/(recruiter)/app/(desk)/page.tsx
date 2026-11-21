import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { DeskApprovals } from '@/features/desk/components/DeskApprovals.tsx';
import { DeskToApprove } from '@/features/desk/components/DeskToApprove.tsx';
import { loadDesk } from '@/features/desk/services/loadDesk.ts';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { requireScreen } from '@/features/shell/services/request.ts';
import { screenMetadata } from '../Placeholder.tsx';

export const generateMetadata = screenMetadata('desk');

// shortcut: My desk shows only rubrics to approve and rubric approvals (AIV-P1-084, AIV-P1-014); its queues, pace table
// and targets come with AIV-P2-017.
export default async function DeskPage() {
  await requireScreen('desk');
  const [desk, t] = await Promise.all([loadDesk(), getTranslations(defaultLocale, defaultTimeZone)]);
  return (
    <>
      <PageHeader title={t('shell.nav.desk')} />
      {/* The Desk artboard's row of cards: side by side, wrapping on narrow screens. */}
      <div className="flex flex-wrap items-start gap-6">
        {desk?.toApprove && (
          <div className="min-w-0 flex-[1_1_420px]">
            <DeskToApprove items={desk.toApprove} />
          </div>
        )}
        <div className="min-w-0 flex-[1_1_420px]">
          <DeskApprovals state={{ status: 'ready', items: desk?.approvals ?? [] }} />
        </div>
      </div>
    </>
  );
}

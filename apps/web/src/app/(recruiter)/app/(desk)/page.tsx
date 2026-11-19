import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import { DeskApprovals } from '@/features/desk/components/DeskApprovals.tsx';
import { loadDesk } from '@/features/desk/services/loadDesk.ts';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { requireScreen } from '@/features/shell/services/request.ts';
import { screenMetadata } from '../Placeholder.tsx';

export const generateMetadata = screenMetadata('desk');

// shortcut: My desk shows only rubric approvals (AIV-P1-014); its queues, pace table and targets come with AIV-P2-017.
export default async function DeskPage() {
  await requireScreen('desk');
  const [items, t] = await Promise.all([loadDesk(), getTranslations(defaultLocale, defaultTimeZone)]);
  return (
    <>
      <PageHeader title={t('shell.nav.desk')} />
      <DeskApprovals state={{ status: 'ready', items: items ?? [] }} />
    </>
  );
}

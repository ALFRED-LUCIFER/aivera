import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import { AuditLog } from '@/features/ops/components/AuditLog.tsx';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

// Shown inside the layout, which has already checked the policy; it holds no log data.
export default async function AuditLoading() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader title={t('ops.audit.title')} />
      <AuditLog table={{ status: 'loading' }} />
    </>
  );
}

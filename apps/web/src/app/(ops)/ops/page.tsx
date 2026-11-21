import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import type { Metadata } from 'next';
import { OpsDashboard } from '@/features/ops/components/OpsDashboard.tsx';
import { dashboardView } from '@/features/ops/domain/dashboard.ts';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { dashboardReads, platformOperator } from '@/server/operator';

export async function generateMetadata(): Promise<Metadata> {
  await platformOperator();
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return { title: t('ops.title') };
}

// The console home (AIV-P2-051): platform counts with links to act. Each tile handles its own failed read.
export default async function OpsHomePage() {
  await platformOperator();
  const [t, reads] = await Promise.all([getTranslations(defaultLocale, defaultTimeZone), dashboardReads()]);
  return (
    <>
      <PageHeader title={t('ops.title')} description={t('ops.signedIn')} />
      <OpsDashboard {...dashboardView(reads, new Date())} />
    </>
  );
}

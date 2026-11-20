import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { workspaceGate } from '@/features/shell/services/request.ts';

// What `forbidden()` renders under Add a job, with HTTP 403: the member's role may not create jobs (`job.create`), or
// the workspace takes no new work (suspended, AIV-P2-037; waiting for approval or not approved, AIV-P2-039).
export default async function Forbidden() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  const gate = (await workspaceGate()) ?? { title: t('access.forbiddenTitle'), body: t('jobNew.forbidden') };
  return (
    <>
      <PageHeader title={gate.title} />
      <p className="text-body text-text-2">{gate.body}</p>
    </>
  );
}

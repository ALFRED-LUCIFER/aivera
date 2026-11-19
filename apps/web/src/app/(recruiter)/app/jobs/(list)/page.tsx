import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import { notFound } from 'next/navigation';
import { toJobRow } from '@/features/jobs-list/domain/jobsList.ts';
import { requireScreen } from '@/features/shell/services/request.ts';
import { getIdentity } from '@/server/auth';
import { getJobs } from '@/server/jobs';
import { getWorkspaces, inActiveWorkspace } from '@/server/workspace';
import { screenMetadata } from '../../Placeholder.tsx';
import { JobsHeader } from './JobsHeader.tsx';
import { JobsListClient } from './JobsListClient.tsx';

export const generateMetadata = screenMetadata('jobs');

// Loading and error states: loading.tsx and error.tsx beside this page, inside the (list) group so /app/jobs/new and
// the job pages keep their own.
export default async function JobsPage() {
  await requireScreen('jobs');
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  // Workspace and job scope come from the request context and row-level security, never from the browser (ADR-005).
  const result = await inActiveWorkspace(async (ctx) => {
    const agency = (await getWorkspaces().getWorkspace(ctx))?.type === 'agency';
    // Archived clients too: their existing jobs keep showing the client's name (AIV-P1-056).
    const clients = agency ? await getWorkspaces().listClients(ctx) : [];
    return { jobs: await getJobs().listJobsForDesk(ctx), agency, clients };
  });
  if (!result) notFound();
  const { jobs, agency, clients } = result.value;
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  // shortcut: one identity read per distinct hiring owner; batch it if agency workspaces list hundreds of jobs.
  const ownerIds = [...new Set(jobs.flatMap((job) => job.hiringOwnerUserId ?? []))];
  const owners = new Map(
    await Promise.all(
      ownerIds.map(async (id) => {
        const user = await getIdentity().getUser(id);
        return [id, user ? (user.displayName ?? user.email) : null] as const;
      }),
    ),
  );
  const rows = jobs.map((job) =>
    toJobRow(job, owners.get(job.hiringOwnerUserId ?? '') ?? null, clientName.get(job.clientId ?? '') ?? null),
  );
  return (
    <>
      <JobsHeader title={t('shell.nav.jobs')} intro={t('jobsList.intro')} add={t('jobsList.add')} />
      <JobsListClient rows={rows} agency={agency} />
    </>
  );
}

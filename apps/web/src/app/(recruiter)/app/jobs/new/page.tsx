import { JOB_TYPE_CATALOGUE } from '@aivera/jobs';
import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import type { Metadata } from 'next';
import Link from 'next/link';
import { newJobOptions } from '@/features/job-new/services/newJobOptions.ts';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { requireScreen } from '@/features/shell/services/request.ts';
import { inActiveWorkspace } from '@/server/workspace';
import { NewJob } from './NewJob.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations(defaultLocale, defaultTimeZone))('jobNew.title') };
}

// shortcut: the members screen (AIV-P1-003) is not built yet, so this link opens a 404 until it ships.
const MEMBERS = '/app/settings/members';

export default async function NewJobPage() {
  // `job.create` first, so an interviewer or hiring owner gets "You do not have access to add jobs." (./forbidden.tsx).
  const result = await inActiveWorkspace(newJobOptions);
  // No workspace yet: the recruiter layout shows the create-workspace page instead of this one.
  if (!result) return null;
  await requireScreen('jobs');
  const { hiringOwners, clients, defaultJobType } = result.value;
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader
        breadcrumb={
          <nav aria-label={t('jobNew.breadcrumb')} className="text-meta text-text-2">
            <Link href="/app/jobs" className="underline underline-offset-2 hover:text-text">
              {t('shell.nav.jobs')}
            </Link>
          </nav>
        }
        title={t('jobNew.title')}
      />
      <NewJob
        defaultJobType={defaultJobType}
        jobTypes={JOB_TYPE_CATALOGUE.map((e) => ({ value: e.key, label: t(e.labelKey), evidence: t(e.evidenceKey) }))}
        hiringOwners={hiringOwners}
        clients={clients}
        membersHref={MEMBERS}
        labels={{
          steps: t('jobNew.steps'),
          stepList: [t('jobNew.step1'), t('jobNew.step2'), t('jobNew.step3'), t('jobNew.step4')],
          jobType: t('jobNew.jobType'),
          jobTypeHint: t('jobNew.jobTypeHint'),
          chooseJobType: t('jobNew.chooseJobType'),
          evidence: t('jobNew.evidence'),
          title: t('jobNew.jobTitle'),
          description: t('jobNew.description'),
          descriptionHint: t('jobNew.descriptionHint'),
          placeholderIntro: t('jobNew.placeholderIntro'),
          team: t('jobNew.team'),
          client: t('jobNew.client'),
          ourTeam: t('jobNew.clientOurTeam'),
          location: t('jobNew.location'),
          optional: t('jobNew.optional'),
          hiringOwner: t('jobNew.hiringOwner'),
          notChosen: t('jobNew.notChosen'),
          noHiringOwner: t('jobNew.noHiringOwner'),
          inviteHiringOwner: t('jobNew.inviteHiringOwner'),
          submit: t('jobNew.submit'),
          drafting: t('jobNew.drafting'),
          save: t('jobNew.save'),
          submitting: t('jobNew.submitting'),
          cancel: t('jobNew.cancel'),
          discardTitle: t('jobNew.discardTitle'),
          discardBody: t('jobNew.discardBody'),
          discard: t('jobNew.discard'),
          keepEditing: t('jobNew.keepEditing'),
          close: t('jobNew.close'),
          errors: {
            title: t('jobNew.errors.title'),
            jobType: t('jobNew.errors.jobType'),
            failed: t('jobNew.errors.failed'),
          },
        }}
      />
    </>
  );
}

import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import type { Metadata } from 'next';
import Link from 'next/link';
import { defaultJobType, jobTypeOptions } from '@/features/job-new/domain/jobNew.ts';
import { newJobOptions } from '@/features/job-new/services/newJobOptions.ts';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { requireScreen } from '@/features/shell/services/request.ts';
import { getCatalogue } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import { NewJob } from './NewJob.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations(defaultLocale, defaultTimeZone))('jobNew.title') };
}

const MEMBERS = '/app/settings/members';

export default async function NewJobPage() {
  // `job.create` first, so an interviewer or hiring owner gets "You do not have access to add jobs." (./forbidden.tsx).
  const result = await inActiveWorkspace(newJobOptions);
  // No workspace yet: the recruiter layout shows the create-workspace page instead of this one.
  if (!result) return null;
  await requireScreen('jobs');
  const { hiringOwners, clients, hiringFocus } = result.value;
  // The published version only (ADR-013 point 15). A failed read throws to ./error.tsx: never a list from code.
  const { version, jobTypes, regions, packs } = await getCatalogue().getPublishedCatalogue();
  // The entries only, not who published them: this goes to the browser.
  const catalogue = { version, jobTypes, regions, packs };
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
        catalogue={catalogue}
        defaultJobType={defaultJobType(hiringFocus, catalogue)}
        jobTypes={jobTypeOptions(catalogue)}
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
            saveFailed: t('access.saveFailed'),
            saveForbidden: t('access.saveForbidden'),
          },
          redraft: {
            title: t('jobNew.redraft.title'),
            body: t('jobNew.redraft.body'),
            confirm: t('jobNew.redraft.confirm'),
            cancel: t('jobNew.redraft.cancel'),
            footer: t('jobNew.redraft.footer'),
            unnamed: t('jobDraft.newCompetency'),
          },
        }}
      />
    </>
  );
}

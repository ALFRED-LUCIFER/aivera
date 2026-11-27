'use client';

import type { Messages } from '@credalent/i18n';
import { useTranslations } from '@credalent/i18n/react';
import { buttonClassName, Chip, DataTable, FilterTabs, type DataTableColumn } from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { profileHref } from '@/features/evidence-profile/domain/profile.ts';
import { jobPageHref } from '@/features/job-header/domain/jobHeader.ts';
import { MeetsNeedCell, NextActionCell, ScoreCell, StageLine } from '@/features/ranking';
import { chosenOrDecided } from '@/features/ranking/domain/choose.ts';
import { ALL_JOBS, type PeopleData, type PersonRow } from '../domain/people.ts';

// AIV-P1-048: Candidates (all jobs), from the People artboard (docs/01-design/artboards/People.dc.html).
// Deviations, each for a later ticket or a rule:
// - no Inbox, Candidates and Talent pool cards: the Inbox (AIV-P1-021) and the talent pool (AIV-P2-022) are not built,
//   and a link to nothing is not shipped; the cards come with the first of them;
// - the stage is the current interview round ("Round 1 on 20 Nov", "Round 1 today, 14:00", "Round 1 complete",
//   AIV-P2-007), else the application's intake stage ("New"), not the artboard's "Evidence assessed";
// - "Next step" is the ranked table's next action ("In shortlist pack", "Open scorecard", "Schedule Round 1", the
//   chosen stage), and "Invite to Round 1" for an assessed person with no interview yet, which opens the job's ranking;
//   "Guide ready" waits for the interview guide (AIV-P2-003) and "Waiting on client for slots" for client slots, so a
//   scheduled round says "Not yet available"; "In shortlist pack" is text, not a link to the pack: the shared cell
//   serves the ranked table too, which links packs from its success line;
// - a person's other jobs open under the "In N jobs" chip in their row (a native disclosure), not as rows of their own,
//   and give each job's backed score and claim range as one line of text, not a second score bar per job;
// - every row is shown, not the first 8: pilot workspaces list tens of people (the footer counts them all);
// - no search field and no assistant panel: AIV-P1-049 and AIV-P2-E06, as in the shell.

export type PeopleView =
  | { status: 'loading' }
  | { status: 'error'; onRetry: () => void }
  | { status: 'ready'; data: PeopleData; tab: string; rows: PersonRow[]; onTabChange: (tab: string) => void };

// Module-level cell renderers (stable across renders); the component adds the translated headers.
const cells: (Omit<DataTableColumn<PersonRow>, 'header'> & { id: keyof Messages['people']['columns'] })[] = [
  { id: 'person', cell: (row) => <PersonCell row={row} /> },
  { id: 'job', cell: (row) => <JobCell row={row} /> },
  { id: 'score', cell: (row) => <ScoreCell row={row.job.row} /> },
  { id: 'meetsNeed', cell: (row) => <MeetsNeedCell score={row.job.row.score} /> },
  { id: 'nextStep', cell: (row) => <NextStepCell row={row} /> },
];

const jobsLink = (chunks: ReactNode) => (
  <Link href="/app/jobs" className="text-text underline underline-offset-2">
    {chunks}
  </Link>
);

/** Everyone in a live process, one row per person, furthest along first. Ranking orders attention (AGENTS.md 1.5). */
export function People({ view }: { view: PeopleView }) {
  const t = useTranslations('people');
  const ready = view.status === 'ready' ? view : null;
  const columns = cells.map((column) => ({ ...column, header: t(`columns.${column.id}`) }));
  return (
    <div className="flex flex-col gap-4">
      {ready && ready.data.people.length > 0 && (
        <>
          <p className="max-w-prose text-body text-text-2">
            {t('intro', { people: ready.data.people.length, jobs: ready.data.jobs.length })}
          </p>
          <FilterTabs
            label={t('filterLabel')}
            tabs={[
              { value: ALL_JOBS, label: t('allJobs'), count: ready.data.people.length },
              ...ready.data.jobs.map((job) => ({ value: job.id, label: job.title, count: job.count })),
            ]}
            value={ready.tab}
            onValueChange={ready.onTabChange}
          />
        </>
      )}
      <DataTable
        caption={t('caption')}
        columns={columns}
        rows={ready?.rows ?? []}
        getRowId={(row) => row.personId}
        emptyMessage={
          <span className="flex flex-col items-start gap-3">
            {t('empty')}
            <Link href="/app/jobs/new" className={buttonClassName('secondary')}>
              {t('addJob')}
            </Link>
          </span>
        }
        loading={view.status === 'loading'}
        loadingLabel={t('loading')}
        {...(view.status === 'error' && {
          error: { message: t('error'), retryLabel: t('retry'), onRetry: view.onRetry },
        })}
        {...(ready &&
          ready.rows.length > 0 && {
            footer: t.rich('footer', { count: ready.rows.length, jobs: jobsLink }),
          })}
      />
    </div>
  );
}

function PersonCell({ row }: { row: PersonRow }) {
  const t = useTranslations();
  return (
    <>
      {/* profileHref builds the path from opaque ids, which typed routes cannot check. */}
      <Link
        href={profileHref(row.personId, row.job.jobId) as Route}
        className="font-semibold text-text underline-offset-2 hover:underline"
      >
        {row.job.row.name ?? t('ranking.unnamed')}
      </Link>
      {row.others.length > 0 && (
        <details className="text-meta text-text-2">
          <summary className="min-h-10 cursor-pointer py-2 pointer-coarse:min-h-11">
            <Chip tone="info" icon={<PeopleIcon />}>
              {t('people.inJobs', { count: row.others.length + 1 })}
            </Chip>
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {row.others.map((other) => (
              <li key={other.jobId}>
                {t('people.otherJob', {
                  job: other.jobTitle,
                  stage: t(`ranking.stages.${other.row.stage}`),
                  backed: other.row.score.backedScore,
                  upTo: other.row.score.upperBound,
                })}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function JobCell({ row }: { row: PersonRow }) {
  return (
    <>
      <span className="font-semibold">{row.job.jobTitle}</span>
      <span className="block text-meta text-text-2">
        <StageLine row={row.job.row} />
      </span>
    </>
  );
}

/**
 * The ranked table's next action; for an assessed person with no interview, pack or decision yet, "Invite to Round 1",
 * which opens the job's ranking, where "Choose for interview" is (AIV-P1-114). Nobody is contacted from either.
 */
function NextStepCell({ row }: { row: PersonRow }) {
  const t = useTranslations('people');
  const { row: candidate, jobId } = row.job;
  if (candidate.inPack || candidate.interview || chosenOrDecided(candidate.stage))
    return <NextActionCell row={candidate} />;
  return (
    // jobPageHref builds the path from the job id, which typed routes cannot check.
    <Link
      href={jobPageHref(jobId, 'candidates') as Route}
      className="font-semibold text-text underline underline-offset-2"
    >
      {t('invite')}
    </Link>
  );
}

function PeopleIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 5.2a3 3 0 0 1 0 5.6M17.5 14.8c2.1.6 3.5 2.4 3.5 5.2" />
    </svg>
  );
}

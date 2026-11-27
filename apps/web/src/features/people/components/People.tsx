'use client';

import type { Messages } from '@credalent/i18n';
import { useTranslations } from '@credalent/i18n/react';
import { buttonClassName, DataTable, FilterTabs, type DataTableColumn } from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { profileHref } from '@/features/evidence-profile/domain/profile.ts';
import { MeetsNeedCell, NextActionCell, ScoreCell } from '@/features/ranking';
import { ALL_JOBS, type PeopleData, type PersonRow } from '../domain/people.ts';

// AIV-P1-048: Candidates (all jobs), from the People artboard (docs/01-design/artboards/People.dc.html).
// Deviations, each for a later ticket or a rule:
// - no Inbox, Candidates and Talent pool cards: the Inbox (AIV-P1-021) and the talent pool (AIV-P2-022) are not built,
//   and a link to nothing is not shipped; the cards come with the first of them;
// - the stage is the application's intake stage ("New", "Chosen for interview"), not the interview round ("Round 1
//   complete", "Round 2 on 21 Nov"): rounds are AIV-P2-007 (#121), as on the ranked table;
// - "Next step" is the ranked table's next action ("In shortlist pack", the chosen stage, else "Not yet available"),
//   which has no "Invite to Round 1" or "Open scorecard" yet (AIV-P2-007);
// - a person's other jobs open under "In N jobs" in their row (a native disclosure), not as rows of their own;
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
  { id: 'nextStep', cell: (row) => <NextActionCell row={row.job.row} /> },
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
          <summary className="flex min-h-10 cursor-pointer items-center pointer-coarse:min-h-11">
            {t('people.inJobs', { count: row.others.length + 1 })}
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
  const t = useTranslations('ranking');
  return (
    <>
      {row.job.jobTitle}
      <span className="block text-meta text-text-2">{t(`stages.${row.job.row.stage}`)}</span>
    </>
  );
}

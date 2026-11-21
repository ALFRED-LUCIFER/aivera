'use client';

import type { Messages } from '@credalent/i18n';
import type { ApplicationListItem } from '@credalent/intake';
import { useTimeZone, useTranslations } from '@credalent/i18n/react';
import { DataTable, ValueBasis, type DataTableColumn } from '@credalent/ui';

// AIV-P1-086: who applied, before anyone is scored, from the Candidates artboard's table (Candidates.dc.html). The
// ranked table (AIV-P1-034) replaces it. Deviations, each for a later ticket or because nothing is assessed yet:
// - no "Who is ahead, and how sure are we?" proof map chart: it plots assessed scores (AIV-P1-035, #99);
// - no "Search candidates" field, rank, compare checkboxes, bulk bar, filters or Columns button: the ranked table's
//   search, ranking and bulk actions are AIV-P1-034 (#98);
// - "Meets the job's need", "Confidence", "Missing critical evidence", "Last review" and "Next action" are not shown:
//   assessment (AIV-P1-031) has not run, and no figure is invented (AGENTS.md 1.7);
// - "Backed score" says "Not yet scored" with the "Not yet available" basis instead of the score bar;
// - the line under each name is the application's intake stage ("New"), not the interview round ("Round 1
//   complete"), which interviews and scorecards record (AIV-P2-E01, #18);
// - the name is plain text, not a link: the candidate profile is AIV-P1-043;
// - the footer keeps only "Ranking orders your attention; nobody is rejected automatically." (AGENTS.md 1.5): every
//   applicant is shown, so no "Showing 7 of 64 assessed" or "Show all 64" until paging (AIV-P1-034, #98);
// - no Credalent assistant panel: the assistant is AIV-P2-028 (#142, epic AIV-P2-E06);
// - "Received" and "Source" columns are added, as the ticket asks, since there is nothing else to tell rows apart.

export type ApplicantListView =
  { status: 'loading' } | { status: 'error'; onRetry: () => void } | { status: 'ready'; rows: ApplicationListItem[] };

type ColumnId = keyof Messages['addApplicants']['list']['columns'];

// Module-level cell renderers (stable across renders); the component adds the translated headers.
const cells: (Omit<DataTableColumn<ApplicationListItem>, 'header'> & { id: ColumnId })[] = [
  { id: 'candidate', cell: (row) => <NameCell row={row} /> },
  { id: 'received', cell: (row) => <ReceivedCell row={row} /> },
  { id: 'source', cell: (row) => <SourceCell row={row} /> },
  { id: 'score', cell: () => <ScoreCell /> },
];

/** Every applicant stays visible, newest first. */
export function ApplicantList({ view }: { view: ApplicantListView }) {
  const t = useTranslations('addApplicants.list');
  const timeZone = useTimeZone();
  const columns = cells.map((column) => ({ ...column, header: t(`columns.${column.id}`, { timeZone }) }));
  return (
    <DataTable
      caption={t('caption')}
      columns={columns}
      rows={view.status === 'ready' ? view.rows : []}
      getRowId={(row) => row.applicationId}
      emptyMessage={t('empty')}
      loading={view.status === 'loading'}
      loadingLabel={t('loading')}
      className="self-stretch"
      {...(view.status === 'ready' && view.rows.length > 0 && { footer: t('fairness') })}
      {...(view.status === 'error' && {
        error: { message: t('error'), retryLabel: t('retry'), onRetry: view.onRetry },
      })}
    />
  );
}

function NameCell({ row }: { row: ApplicationListItem }) {
  const t = useTranslations('addApplicants');
  return (
    <>
      <span className="font-semibold">{row.displayName ?? t('unnamed')}</span>
      <span className="block text-meta text-text-2">{t(`list.stages.${row.stage}`)}</span>
    </>
  );
}

function ReceivedCell({ row }: { row: ApplicationListItem }) {
  const t = useTranslations('addApplicants.list');
  return <span className="whitespace-nowrap tabular-nums">{t('receivedOn', { value: row.receivedAt })}</span>;
}

function SourceCell({ row }: { row: ApplicationListItem }) {
  const t = useTranslations('addApplicants.sources');
  return t(row.source);
}

function ScoreCell() {
  const t = useTranslations('addApplicants.list');
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {t('notScored')}
      <ValueBasis basis="not-available" label={t('notYetAvailable')} />
    </span>
  );
}

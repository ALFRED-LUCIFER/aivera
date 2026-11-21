'use client';

import type { Messages } from '@credalent/i18n';
import type { ApplicationListItem } from '@credalent/intake';
import { useTimeZone, useTranslations } from '@credalent/i18n/react';
import { DataTable, ValueBasis, type DataTableColumn } from '@credalent/ui';

// AIV-P1-086: who applied, before anyone is scored, from the Candidates artboard's table (Candidates.dc.html). The
// ranked table (AIV-P1-034) replaces it. Deviations, each for a later ticket or because nothing is assessed yet:
// - no rank, compare checkboxes, bulk bar, filters or Columns button: ranking and bulk actions are AIV-P1-034;
// - "Meets the job's need", "Confidence", "Missing critical evidence", "Last review" and "Next action" are not shown:
//   assessment (AIV-P1-031) has not run, and no figure is invented (AGENTS.md 1.7);
// - "Backed score" says "Not yet scored" with the "Not yet available" basis instead of the score bar;
// - the name is plain text, not a link: the candidate profile is AIV-P1-043;
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

/** Every applicant stays visible, newest first; the empty message is the Candidates tab's own. */
export function ApplicantList({ view }: { view: ApplicantListView }) {
  const t = useTranslations('addApplicants.list');
  const empty = useTranslations('jobHeader.empty');
  const timeZone = useTimeZone();
  const columns = cells.map((column) => ({ ...column, header: t(`columns.${column.id}`, { timeZone }) }));
  return (
    <DataTable
      caption={t('caption')}
      columns={columns}
      rows={view.status === 'ready' ? view.rows : []}
      getRowId={(row) => row.applicationId}
      emptyMessage={empty('candidates')}
      loading={view.status === 'loading'}
      loadingLabel={t('loading')}
      className="self-stretch"
      {...(view.status === 'error' && {
        error: { message: t('error'), retryLabel: t('retry'), onRetry: view.onRetry },
      })}
    />
  );
}

function NameCell({ row }: { row: ApplicationListItem }) {
  const t = useTranslations('addApplicants');
  return <span className="font-semibold">{row.displayName ?? t('unnamed')}</span>;
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

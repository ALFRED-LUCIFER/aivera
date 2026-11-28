'use client';

import type { Messages } from '@credalent/i18n';
import { useTranslations } from '@credalent/i18n/react';
import {
  buttonClassName,
  DataTable,
  FilterTabs,
  Label,
  Select,
  StatusBadge,
  UploadIcon,
  ValueBasis,
  type DataTableColumn,
} from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { jobPageHref } from '@/features/job-header/domain/jobHeader.ts';
import {
  JOB_FILTERS,
  jobHref,
  parseFilter,
  rowButton,
  rubricLabel,
  type ClientOption,
  type JobFilter,
  type JobRow,
} from '../domain/jobsList.ts';

export type JobsListView =
  | { status: 'loading' }
  | { status: 'error'; onRetry: () => void }
  | {
      status: 'ready';
      rows: JobRow[];
      total: number;
      filter: JobFilter;
      counts: Record<JobFilter, number>;
      onFilterChange: (filter: JobFilter) => void;
      /** An agency's clients for the Client column and filter; null for an in-house team (AIV-P1-056). */
      clients: ClientOption[] | null;
      /** The chosen client's id; '' is every job. */
      client: string;
      onClientChange: (client: string) => void;
    };

// Module-level cell renderers (stable across renders); the component adds the translated headers.
const cells: (Omit<DataTableColumn<JobRow>, 'header'> & { id: keyof Messages['jobsList']['columns'] })[] = [
  { id: 'job', cell: (row) => <JobCell row={row} /> },
  { id: 'client', cell: (row) => <ClientCell row={row} /> },
  { id: 'hiringOwner', cell: (row) => <OwnerCell row={row} /> },
  { id: 'stage', cell: (row) => <StageCell row={row} /> },
  { id: 'assessed', cell: (row) => <Figure value={row.assessed} /> },
  { id: 'coverage', cell: (row) => <CoverageCell row={row} /> },
  { id: 'rubric', cell: (row) => <RubricCell row={row} /> },
  { id: 'nextAction', cell: (row) => <NextActionCell row={row} /> },
];
// The next action as the row's button, for admins and recruiters.
const actionCell = (row: JobRow) => <NextActionButton row={row} />;

/**
 * Every job, where it stands and what it needs (AIV-P1-006). Every figure shows its basis (AGENTS.md 1.7).
 * Deviations from the Roles artboard (AIV-P1-165): for admins and recruiters the next action is the row's one button
 * ("Approve the rubric", or "Add CVs" on an approved job), not a line of text with "Import candidates" under it; a
 * count of zero reads "0" with no basis chip, since nothing was observed yet.
 */
export function JobsList({ view, canImport = false }: { view: JobsListView; canImport?: boolean }) {
  const t = useTranslations('jobsList');
  const agency = view.status === 'ready' && view.clients !== null;
  const columns = cells
    .filter((column) => agency || column.id !== 'client')
    .map((column) => ({
      ...column,
      header: t(`columns.${column.id}`),
      cell: canImport && column.id === 'nextAction' ? actionCell : column.cell,
    }));

  return (
    <div className="flex flex-col gap-4">
      {view.status === 'ready' && view.clients && view.clients.length > 0 && (
        <div className="flex max-w-xs flex-col gap-1">
          <Label htmlFor="jobs-client-filter">{t('clientFilter')}</Label>
          <Select
            id="jobs-client-filter"
            value={view.client}
            onChange={(event) => view.onClientChange(event.target.value)}
          >
            <option value="">{t('allClients')}</option>
            {view.clients.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </div>
      )}
      {view.status === 'ready' && view.total > 0 && (
        <FilterTabs
          label={t('filterLabel')}
          tabs={JOB_FILTERS.map((filter) => ({
            value: filter,
            label: t(`filters.${filter}`),
            count: view.counts[filter],
          }))}
          value={view.filter}
          onValueChange={(value) => view.onFilterChange(parseFilter(value))}
        />
      )}
      <DataTable
        caption={t('caption')}
        columns={columns}
        rows={view.status === 'ready' ? view.rows : []}
        getRowId={(row) => row.id}
        emptyMessage={view.status === 'ready' && view.total > 0 ? t('emptyFiltered') : t('empty')}
        loading={view.status === 'loading'}
        loadingLabel={t('loading')}
        {...(view.status === 'error' && {
          error: { message: t('error'), retryLabel: t('retry'), onRetry: view.onRetry },
        })}
      />
    </div>
  );
}

function JobCell({ row }: { row: JobRow }) {
  return (
    <>
      {/* jobHref builds the path from the job id, which typed routes cannot check. */}
      <Link href={jobHref(row) as Route} className="font-semibold text-text underline-offset-2 hover:underline">
        {row.title}
      </Link>
      {(row.team || row.location) && (
        <span className="block text-meta text-text-2">{[row.team, row.location].filter(Boolean).join(' · ')}</span>
      )}
    </>
  );
}

function ClientCell({ row }: { row: JobRow }) {
  const t = useTranslations('jobsList');
  return row.client ?? t('ourTeam');
}

function OwnerCell({ row }: { row: JobRow }) {
  const t = useTranslations('jobsList');
  return row.hiringOwner ?? t('noHiringOwner');
}

function StageCell({ row }: { row: JobRow }) {
  const t = useTranslations('jobsList');
  return t(`stage.${row.stage}`);
}

/** A count or a percentage with its basis; null is "Not yet available". */
function Figure({ value, percent = false }: { value: number | null; percent?: boolean }) {
  const t = useTranslations('jobsList');
  if (value === null) return <ValueBasis basis="not-available" label={t('notYetAvailable')} />;
  // Zero is nothing observed yet: the bare figure, no "Observed" chip (AIV-P1-165).
  if (value === 0 && !percent) return <span className="tabular-nums">{t('count', { count: 0 })}</span>;
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      {percent ? t('percent', { value }) : t('count', { count: value })}
      <ValueBasis basis="observed" label={t('observed')} />
    </span>
  );
}

function CoverageCell({ row }: { row: JobRow }) {
  const t = useTranslations('jobsList');
  if (!row.rubric.approved) return <span className="text-text-2">{t('coverageAfterApproval')}</span>;
  return <Figure value={row.coveragePercent} percent />;
}

function RubricCell({ row }: { row: JobRow }) {
  const t = useTranslations('jobsList');
  return (
    <StatusBadge
      status={row.rubric.approved ? 'supported' : 'needsValidation'}
      label={t(`rubric.${rubricLabel(row.rubric)}`)}
    />
  );
}

function NextActionButton({ row }: { row: JobRow }) {
  const t = useTranslations('jobsList');
  const page = rowButton(row);
  if (!page) return <NextActionCell row={row} />;
  return (
    // jobPageHref builds the path from the job id, which typed routes cannot check.
    <Link href={jobPageHref(row.id, page) as Route} className={buttonClassName('secondary', 'compact')}>
      {page === 'import' && <UploadIcon className="size-3.5" />}
      {t(page === 'import' ? 'import' : 'nextAction.approve_rubric')}
    </Link>
  );
}

function NextActionCell({ row: { nextAction } }: { row: JobRow }) {
  const t = useTranslations('jobsList');
  if (!nextAction) return <ValueBasis basis="not-available" label={t('notYetAvailable')} />;
  return nextAction.kind === 'chase_evidence'
    ? t('nextAction.chase_evidence', { count: nextAction.count })
    : t(`nextAction.${nextAction.kind}`);
}

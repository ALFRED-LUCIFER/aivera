'use client';

import type { Messages } from '@aivera/i18n';
import { useTranslations } from '@aivera/i18n/react';
import { DataTable, FilterTabs, Label, Select, StatusBadge, ValueBasis, type DataTableColumn } from '@aivera/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { JOB_FILTERS, jobHref, parseFilter, rubricLabel, type JobFilter, type JobRow } from '../domain/jobsList.ts';

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
      /** An agency's client names for the Client column and filter; null for an in-house team (AIV-P1-056). */
      clients: string[] | null;
      /** The chosen client's name; '' is every job. */
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

/** Every job, where it stands and what it needs (AIV-P1-006). Every figure shows its basis (AGENTS.md 1.7). */
export function JobsList({ view }: { view: JobsListView }) {
  const t = useTranslations('jobsList');
  const agency = view.status === 'ready' && view.clients !== null;
  const columns = cells
    .filter((column) => agency || column.id !== 'client')
    .map((column) => ({ ...column, header: t(`columns.${column.id}`) }));

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
            {view.clients.map((name) => (
              <option key={name} value={name}>
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
      {/* shortcut: the rubric and ranking pages arrive with AIV-P1-012 and AIV-P1-034, so the route is not typed yet. */}
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

function NextActionCell({ row: { nextAction } }: { row: JobRow }) {
  const t = useTranslations('jobsList');
  if (!nextAction) return <ValueBasis basis="not-available" label={t('notYetAvailable')} />;
  return nextAction.kind === 'chase_evidence'
    ? t('nextAction.chase_evidence', { count: nextAction.count })
    : t(`nextAction.${nextAction.kind}`);
}

'use client';

import type { Messages } from '@credalent/i18n';
import { useTimeZone, useTranslations } from '@credalent/i18n/react';
import { Button, DataTable, Input, Label, ValueBasis, type DataTableColumn } from '@credalent/ui';
import Link from 'next/link';
import {
  workspaceHref,
  type WorkspaceRow,
  type WorkspaceSearch,
  type WorkspacesListView,
} from '../domain/workspaces.ts';
import { SyntheticBadge, WorkspaceStatus } from './WorkspaceBadges.tsx';

type WorkspacesFilter = Pick<WorkspaceSearch, 'status' | 'sort'>;

type ColumnId = keyof Messages['ops']['workspaces']['columns'];

// Module-level cell renderers (stable across renders); the component adds the translated headers.
const cells: (Omit<DataTableColumn<WorkspaceRow>, 'header'> & { id: ColumnId })[] = [
  { id: 'workspace', cell: (row) => <NameCell row={row} /> },
  { id: 'type', cell: (row) => <TypeCell row={row} /> },
  { id: 'created', cell: (row) => <CreatedCell row={row} /> },
  { id: 'members', numeric: true, cell: (row) => <Count value={row.activeMembers} /> },
  { id: 'jobs', numeric: true, cell: (row) => <Count value={row.jobs} /> },
  { id: 'aiToday', numeric: true, cell: (row) => <AiTodayCell row={row} /> },
  { id: 'status', cell: (row) => <WorkspaceStatus status={row.status} /> },
  { id: 'plan', cell: () => <NoPlan /> },
];

/**
 * Every workspace's platform facts, newest first, 50 per page (AIV-P2-036). Never a member or candidate.
 * Deviation from the console spec (AIV-P2-041): each row keeps its own "Observed" marker rather than one in the column
 * header, because DESIGN.md gives every metric its marker and the shared table header takes text only.
 */
export function WorkspacesList({ search, table }: WorkspacesListView) {
  const t = useTranslations('ops.workspaces');
  const timeZone = useTimeZone();
  const columns = cells.map((column) => ({ ...column, header: t(`columns.${column.id}`, { timeZone }) }));
  const ready = table.status === 'ready' ? table : null;

  return (
    <div className="flex flex-col gap-4">
      {search && (
        <search>
          <form
            className="flex max-w-xl flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              search.onSearch();
            }}
          >
            <div className="flex min-w-60 grow flex-col gap-1.5">
              <Label htmlFor="ops-workspace-search">{t('searchLabel')}</Label>
              <Input
                id="ops-workspace-search"
                type="search"
                maxLength={100}
                value={search.query}
                onChange={(event) => search.onQueryChange(event.target.value)}
              />
            </div>
            <Button type="submit" variant="primary">
              {t('search')}
            </Button>
          </form>
        </search>
      )}
      {ready && (ready.filter.status || ready.filter.sort === 'ai') && <FilterLine {...ready.filter} />}
      <DataTable
        caption={t('caption')}
        columns={columns}
        rows={ready?.rows ?? []}
        getRowId={(row) => row.id}
        emptyMessage={ready?.searched ? t('noMatch', { query: ready.searched }) : t('empty')}
        loading={table.status === 'loading'}
        loadingLabel={t('loading')}
        {...(table.status === 'error' && {
          error: { message: t('error'), retryLabel: t('retry'), onRetry: table.onRetry },
        })}
        footer={ready && ready.pageCount > 1 && <Pager {...ready} />}
      />
    </div>
  );
}

// The console home's filter or sort (AIV-P2-051), said in words with the way back to the full list.
function FilterLine({ status, sort }: WorkspacesFilter) {
  const t = useTranslations('ops.workspaces');
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-text-2">
      {status && <span>{t('filteredBy', { status: t(`status.${status}`) })}</span>}
      {sort === 'ai' && <span>{t('sortedByAi')}</span>}
      <Link href="/ops/workspaces" className="font-medium text-text underline underline-offset-2">
        {t('showAll')}
      </Link>
    </p>
  );
}

function Pager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (page: number) => void }) {
  const t = useTranslations('ops.workspaces');
  return (
    <>
      <span>{t('pages', { page, count: pageCount })}</span>
      <span className="flex gap-2">
        <Button size="compact" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t('previous')}
        </Button>
        <Button size="compact" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          {t('next')}
        </Button>
      </span>
    </>
  );
}

function NameCell({ row }: { row: WorkspaceRow }) {
  return (
    <>
      {/* No prefetch: opening a workspace is recorded on the server (ADR-012), so only a real visit may render it. */}
      <Link
        href={workspaceHref(row.id)}
        prefetch={false}
        className="font-semibold text-text underline-offset-2 hover:underline"
      >
        {row.name}
      </Link>
      {row.synthetic && <SyntheticBadge className="ms-2" />}
    </>
  );
}

function TypeCell({ row }: { row: WorkspaceRow }) {
  const t = useTranslations('ops.workspaces.type');
  return <span className="whitespace-nowrap">{t(row.type)}</span>;
}

function CreatedCell({ row }: { row: WorkspaceRow }) {
  const t = useTranslations('ops.workspaces');
  return <span className="whitespace-nowrap">{t('createdOn', { value: row.createdAt })}</span>;
}

function Count({ value }: { value: number }) {
  const t = useTranslations('ops.workspaces');
  return <>{t('count', { count: value })}</>;
}

// Today's AI tokens with their basis (AIV-P2-038): observed, or "Not yet available" when the store could not be read.
function AiTodayCell({ row }: { row: WorkspaceRow }) {
  const t = useTranslations('ops.workspaces');
  return row.ai ? (
    <span className="inline-flex items-center gap-2">
      {t('count', { count: row.ai.days[0]?.tokens ?? 0 })}
      <ValueBasis basis="observed" label={t('ai.observed')} />
    </span>
  ) : (
    <ValueBasis basis="not-available" label={t('ai.notAvailable')} />
  );
}

function NoPlan() {
  const t = useTranslations('ops.workspaces');
  return <span className="whitespace-nowrap text-text-2">{t('noPlan')}</span>;
}

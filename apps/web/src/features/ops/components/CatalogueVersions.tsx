'use client';

import type { Messages } from '@credalent/i18n';
import { useTimeZone, useTranslations } from '@credalent/i18n/react';
import { SEED_ACTOR } from '@credalent/jobs';
import { buttonClassName, DataTable, StatusBadge, type DataTableColumn, type StatusBadgeStatus } from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { versionHref, versionsHref, type VersionRow } from '../domain/catalogueHistory.ts';

/*
 * The catalogue version history (AIV-P2-050) from the console spec's table rules (operator-console.md); there is no
 * artboard. Read-only: no row has an action but opening the version.
 */

type ColumnId = keyof Messages['ops']['catalogue']['history']['columns'];

const BADGES: Record<NonNullable<VersionRow['evalStatus']>, StatusBadgeStatus> = {
  passed: 'supported',
  failed: 'contradiction',
  error: 'contradiction',
  running: 'informational',
};

const cells: (Omit<DataTableColumn<VersionRow>, 'header'> & { id: ColumnId })[] = [
  { id: 'version', cell: (row) => <VersionCell row={row} /> },
  { id: 'publishedAt', cell: (row) => <PublishedAt row={row} /> },
  { id: 'publishedBy', cell: (row) => <Publisher row={row} /> },
  { id: 'reason', cell: (row) => row.reason },
  { id: 'changes', cell: (row) => <Changes row={row} /> },
  { id: 'eval', cell: (row) => <EvalBadge row={row} /> },
];

export function CatalogueVersions({ rows, page, pageCount }: { rows: VersionRow[]; page: number; pageCount: number }) {
  const t = useTranslations('ops.catalogue.history');
  const timeZone = useTimeZone();
  const columns = cells.map((column) => ({ ...column, header: t(`columns.${column.id}`, { timeZone }) }));
  const pager = buttonClassName('secondary', 'compact');
  return (
    <DataTable
      caption={t('caption')}
      columns={columns}
      rows={rows}
      getRowId={(row) => String(row.version)}
      emptyMessage={t('empty')}
      footer={
        pageCount > 1 && (
          <>
            <span>{t('pages', { page, count: pageCount })}</span>
            <span className="flex gap-2">
              {page > 1 && (
                <Link href={versionsHref(page - 1) as Route} className={pager}>
                  {t('previous')}
                </Link>
              )}
              {page < pageCount && (
                <Link href={versionsHref(page + 1) as Route} className={pager}>
                  {t('next')}
                </Link>
              )}
            </span>
          </>
        )
      }
    />
  );
}

function VersionCell({ row }: { row: VersionRow }) {
  const t = useTranslations('ops.catalogue.history');
  return (
    <Link
      href={versionHref(row.version)}
      className="font-semibold whitespace-nowrap text-text underline-offset-2 hover:underline"
    >
      {t('version', { version: row.version })}
    </Link>
  );
}

function PublishedAt({ row }: { row: VersionRow }) {
  const t = useTranslations('ops.catalogue.history');
  return <span className="whitespace-nowrap">{t('publishedAt', { at: row.publishedAt })}</span>;
}

/** The operator's name, "System" for the seed (version 1). */
export function Publisher({ row }: { row: VersionRow }) {
  const t = useTranslations('ops.catalogue.history');
  if (row.publisherName) return row.publisherName;
  return <span className="text-text-2">{t(row.publishedBy === SEED_ACTOR ? 'system' : 'unknown')}</span>;
}

/** "1 added · 1 edited · 1 retired", or "First version" for the version with nothing before it. */
export function Changes({ row }: { row: VersionRow }) {
  const t = useTranslations('ops.catalogue.history');
  return <span className="whitespace-nowrap">{row.counts ? t('counts', row.counts) : t('first')}</span>;
}

export function EvalBadge({ row }: { row: VersionRow }) {
  const t = useTranslations('ops.catalogue');
  return row.evalStatus ? (
    <StatusBadge status={BADGES[row.evalStatus]} label={t(`editor.eval.status.${row.evalStatus}`)} />
  ) : (
    <StatusBadge status="informational" label={t('history.noEval')} />
  );
}

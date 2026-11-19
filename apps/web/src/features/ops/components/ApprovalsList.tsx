'use client';

import type { Messages } from '@aivera/i18n';
import { useTimeZone, useTranslations } from '@aivera/i18n/react';
import { DataTable, type DataTableColumn } from '@aivera/ui';
import type { ReactNode } from 'react';
import type { PendingRow } from '../domain/workspaces.ts';

type Row = PendingRow & { decide: ReactNode };
type ColumnId = keyof Messages['ops']['approvals']['columns'];

// Module-level cell renderers (stable across renders); the component adds the translated headers.
const cells: (Omit<DataTableColumn<Row>, 'header'> & { id: ColumnId })[] = [
  { id: 'workspace', cell: (row) => row.name },
  { id: 'type', cell: (row) => <TypeCell row={row} /> },
  { id: 'created', cell: (row) => <CreatedCell row={row} /> },
  { id: 'creator', cell: (row) => <CreatorCell row={row} /> },
  { id: 'decision', cell: (row) => <div className="flex flex-wrap gap-2">{row.decide}</div> },
];

/**
 * Workspaces waiting for approval, oldest first (AIV-P2-039): name, type, created date, the creator's email so the
 * operator can contact them, and the Approve and Reject cards (`decide`) for each. `failed` shows the load error.
 */
export function ApprovalsList({ rows, failed }: { rows: Row[]; failed?: { onRetry: () => void } }) {
  const t = useTranslations('ops.approvals');
  const timeZone = useTimeZone();
  const columns = cells.map((column) => ({ ...column, header: t(`columns.${column.id}`, { timeZone }) }));
  return (
    <DataTable
      caption={t('caption')}
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      emptyMessage={t('empty')}
      {...(failed && { error: { message: t('error'), retryLabel: t('retry'), onRetry: failed.onRetry } })}
    />
  );
}

function TypeCell({ row }: { row: Row }) {
  const t = useTranslations('ops.workspaces');
  return t(`type.${row.type}`);
}

function CreatedCell({ row }: { row: Row }) {
  const t = useTranslations('ops.workspaces');
  return t('createdOn', { value: row.createdAt });
}

function CreatorCell({ row }: { row: Row }) {
  const t = useTranslations('ops.approvals');
  return row.creatorEmail ?? t('noCreator');
}

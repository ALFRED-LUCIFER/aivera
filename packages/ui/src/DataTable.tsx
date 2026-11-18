'use client';

import type { ReactNode } from 'react';
import { Button } from './Button.tsx';
import { Skeleton } from './Card.tsx';
import { Checkbox } from './Checkbox.tsx';
import { cx } from './cx.ts';

/** Plain data, so a feature keeps its columns in `domain/` (ADR-003). */
export type DataTableColumn<Row> = {
  id: string;
  header: string;
  cell: (row: Row) => ReactNode;
  sortable?: boolean;
  /** Right-aligned tabular figures; sorts descending first (highest score on top). */
  numeric?: boolean;
};

export type SortDirection = 'ascending' | 'descending';
export type DataTableSort = { columnId: string; direction: SortDirection };

export type DataTableSelection<Row> = {
  selectedIds: readonly string[];
  onSelectedIdsChange: (ids: string[]) => void;
  /** Names the select-all checkbox, e.g. "Select all". */
  allLabel: string;
  /** Names a row's checkbox, e.g. "Select Youssef Aziz". */
  rowLabel: (row: Row) => string;
};

export type DataTableProps<Row> = {
  /** Names the table for assistive technology. */
  caption: string;
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowId: (row: Row) => string;
  /** Controlled by the caller, which sorts the rows (often on the server). */
  sort?: DataTableSort | undefined;
  onSortChange?: (sort: DataTableSort) => void;
  /** Adds the "Select" checkbox column. */
  selection?: DataTableSelection<Row>;
  /** Shown when there are no rows. */
  emptyMessage: ReactNode;
  loading?: boolean;
  error?: { message: string; retryLabel: string; onRetry: () => void };
  /** Under the table: "Showing 7 of 64 …" and the caller's "Show more" button. */
  footer?: ReactNode;
  /** For layout; give a max height here to keep the sticky header in view inside the box. */
  className?: string;
};

const SKELETON_ROWS = 5;
const cellBase = 'border-b border-border px-3 py-2.5 align-middle';

/**
 * A real <table> in its own scroll box, so a wide table scrolls inside the box at phone width, never the page.
 * Empty, loading and error replace the body; the header stays so the columns are still announced.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  getRowId,
  sort,
  onSortChange,
  selection,
  emptyMessage,
  loading = false,
  error,
  footer,
  className,
}: DataTableProps<Row>) {
  const ids = rows.map(getRowId);
  const selected = new Set(selection?.selectedIds);
  const selectedHere = ids.filter((id) => selected.has(id)).length;
  // Empty means nothing to select: no select-all box (Gherkin: "no header checkbox").
  const showSelect = selection && !loading && !error && rows.length > 0;
  const span = columns.length + (showSelect ? 1 : 0);

  const toggleAll = () =>
    selection?.onSelectedIdsChange(
      selectedHere === ids.length
        ? [...selected].filter((id) => !ids.includes(id))
        : [...new Set([...selected, ...ids])],
    );
  const toggleRow = (id: string) =>
    selection?.onSelectedIdsChange(selected.has(id) ? [...selected].filter((s) => s !== id) : [...selected, id]);

  const nextSort = (column: DataTableColumn<Row>): DataTableSort => {
    const first: SortDirection = column.numeric ? 'descending' : 'ascending';
    const flip: SortDirection = sort?.direction === 'ascending' ? 'descending' : 'ascending';
    return { columnId: column.id, direction: sort?.columnId === column.id ? flip : first };
  };

  let body: ReactNode;
  if (error) {
    body = (
      <tr>
        <td colSpan={span} className={cx(cellBase, 'py-6 text-center')}>
          <p className="mb-3 text-body text-text">{error.message}</p>
          <Button onClick={error.onRetry}>{error.retryLabel}</Button>
        </td>
      </tr>
    );
  } else if (loading) {
    body = Array.from({ length: SKELETON_ROWS }, (_, i) => (
      <tr key={i}>
        {columns.map((column) => (
          <td key={column.id} className={cellBase}>
            <Skeleton className="h-4" />
          </td>
        ))}
      </tr>
    ));
  } else if (rows.length === 0) {
    body = (
      <tr>
        <td colSpan={span} className={cx(cellBase, 'py-6 text-center text-text-2')}>
          {emptyMessage}
        </td>
      </tr>
    );
  } else {
    body = rows.map((row, i) => {
      const id = ids[i] ?? '';
      return (
        <tr key={id} className="hover:bg-surface-subtle has-checked:bg-surface-subtle">
          {showSelect && (
            <td className={cx(cellBase, 'w-12 py-0')}>
              <Checkbox
                checked={selected.has(id)}
                onChange={() => toggleRow(id)}
                label={<span className="sr-only">{selection.rowLabel(row)}</span>}
                className="w-full justify-center"
              />
            </td>
          )}
          {columns.map((column) => (
            <td key={column.id} className={cx(cellBase, column.numeric ? 'text-end tabular-nums' : 'text-start')}>
              {column.cell(row)}
            </td>
          ))}
        </tr>
      );
    });
  }

  return (
    <div
      className={cx('flex flex-col overflow-hidden rounded-card border border-border bg-surface shadow-1', className)}
    >
      <div className="min-h-0 overflow-auto">
        <table aria-busy={loading || undefined} className="w-full border-separate border-spacing-0 text-body text-text">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-10 bg-surface-subtle text-meta font-semibold text-text-2">
            <tr>
              {showSelect && (
                <th scope="col" className={cx(cellBase, 'w-12 py-0')}>
                  <Checkbox
                    checked={selectedHere === ids.length}
                    ref={(input) => {
                      if (input) input.indeterminate = selectedHere > 0 && selectedHere < ids.length;
                    }}
                    onChange={toggleAll}
                    label={<span className="sr-only">{selection.allLabel}</span>}
                    className="w-full justify-center"
                  />
                </th>
              )}
              {columns.map((column) => {
                const active = sort?.columnId === column.id;
                const align = column.numeric ? 'text-end' : 'text-start';
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={column.sortable ? (active ? sort.direction : 'none') : undefined}
                    className={cx(cellBase, align, column.sortable && 'py-0')}
                  >
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => onSortChange(nextSort(column))}
                        className={cx(
                          'inline-flex min-h-10 cursor-pointer items-center gap-1 font-semibold pointer-coarse:min-h-11',
                          'hover:text-text',
                          active && 'text-text',
                        )}
                      >
                        {column.header}
                        <SortIcon direction={active ? sort.direction : undefined} />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>
      {footer && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-meta text-text-2">
          {footer}
        </div>
      )}
    </div>
  );
}

const sortPaths = { ascending: 'm4 10 4-4 4 4', descending: 'm4 6 4 4 4-4', none: 'm5 6 3-3 3 3M5 10l3 3 3-3' };

function SortIcon({ direction }: { direction: SortDirection | undefined }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
    >
      <path d={sortPaths[direction ?? 'none']} />
    </svg>
  );
}

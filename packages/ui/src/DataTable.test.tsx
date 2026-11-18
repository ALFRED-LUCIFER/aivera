import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BulkActionBar, type BulkAction } from './BulkActionBar.tsx';
import { DataTable, type DataTableColumn, type DataTableSort } from './DataTable.tsx';
import { FilterTabs } from './FilterTabs.tsx';

// Synthetic cast: docs/00-product/personas.md (Inbox arrivals).
type Application = { id: string; name: string; backed: number; needsAction: boolean; rubricApproved: boolean };

const inbox: Application[] = [
  { id: 'a1', name: 'Fatima Al Hammadi', backed: 52, needsAction: true, rubricApproved: true },
  { id: 'a2', name: 'Sneha Iyer', backed: 61, needsAction: false, rubricApproved: true },
  { id: 'a3', name: 'Anna Schmidt', backed: 47, needsAction: true, rubricApproved: true },
  { id: 'a4', name: 'Mark Reyes', backed: 58, needsAction: false, rubricApproved: false },
  { id: 'a5', name: 'Youssef Aziz', backed: 66, needsAction: false, rubricApproved: true },
  { id: 'a6', name: 'Paolo Garcia', backed: 39, needsAction: false, rubricApproved: true },
  { id: 'a7', name: 'Tarek Mansour', backed: 63, needsAction: false, rubricApproved: true },
];

const columns: DataTableColumn<Application>[] = [
  { id: 'name', header: 'Candidate', cell: (r) => r.name, sortable: true },
  { id: 'backed', header: 'Backed score', cell: (r) => r.backed, sortable: true, numeric: true },
];

type Preview = { title: string; ids: readonly string[] };

const filters = {
  all: () => true,
  needsAction: (r: Application) => r.needsAction,
  rubric: (r: Application) => !r.rubricApproved,
};

/** What a feature does: keeps filter, sort and selection, filters and sorts the rows, and opens the preview. */
function InboxHarness({ rows, onPreview }: { rows: Application[]; onPreview: (p: Preview) => void }) {
  const [filter, setFilter] = useState<keyof typeof filters>('all');
  const [sort, setSort] = useState<DataTableSort>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const shown = rows.filter(filters[filter]).toSorted((a, b) => {
    if (!sort) return 0;
    const key = sort.columnId as 'name' | 'backed';
    const order = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
    return sort.direction === 'ascending' ? order : -order;
  });
  const actions: BulkAction<Preview>[] = ['Request evidence', 'Assess fully', 'Add to talent pool'].map((label) => ({
    id: label,
    label,
    preview: (ids) => ({ title: `Preview: ${label}`, ids }),
  }));
  return (
    <>
      <FilterTabs
        label="Filter applications"
        value={filter}
        onValueChange={(v) => setFilter(v as keyof typeof filters)}
        tabs={[
          { value: 'all', label: 'All', count: rows.length },
          { value: 'needsAction', label: 'Needs your action', count: rows.filter(filters.needsAction).length },
          { value: 'rubric', label: 'Rubric not approved', count: rows.filter(filters.rubric).length },
        ]}
      />
      <DataTable
        caption="Applications"
        columns={columns}
        rows={shown}
        getRowId={(r) => r.id}
        sort={sort}
        onSortChange={setSort}
        selection={{
          selectedIds,
          onSelectedIdsChange: setSelectedIds,
          allLabel: 'Select all',
          rowLabel: (r) => `Select ${r.name}`,
        }}
        emptyMessage="No applications yet."
      />
      <BulkActionBar
        selectedIds={selectedIds}
        selectedLabel={`${selectedIds.length} selected`}
        previewNote="Bulk actions always show a preview first."
        actions={actions}
        onPreview={onPreview}
      />
    </>
  );
}

const bodyNames = () =>
  within(screen.getAllByRole('rowgroup')[1] as HTMLElement)
    .getAllByRole('row')
    .map((row) => within(row).getAllByRole('cell')[1]?.textContent);

describe('Scenario: Selecting rows reveals the bulk-action bar', () => {
  // SAFETY: mutation check: rendered the bar's actions when nothing is selected -> failed
  it('shows "2 selected", the three actions and the preview line', async () => {
    render(<InboxHarness rows={inbox} onPreview={vi.fn()} />);
    expect(screen.getAllByRole('row')).toHaveLength(8); // header + 7
    expect(screen.queryByRole('button', { name: 'Request evidence' })).toBeNull();
    expect(screen.queryByText('Bulk actions always show a preview first.')).toBeNull();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Youssef Aziz' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Paolo Garcia' }));

    expect(screen.getByRole('status').textContent).toBe('2 selected');
    for (const name of ['Request evidence', 'Assess fully', 'Add to talent pool']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.getByText('Bulk actions always show a preview first.')).toBeTruthy();
  });

  // SAFETY: mutation check: dropped the indeterminate assignment -> failed
  it('select-all is mixed while some rows are ticked, then ticks and clears every row', async () => {
    render(<InboxHarness rows={inbox} onPreview={vi.fn()} />);
    const all = screen.getByRole('checkbox', { name: 'Select all' }) as HTMLInputElement;
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Youssef Aziz' }));
    expect(all.indeterminate).toBe(true);
    expect(all.checked).toBe(false);

    await userEvent.click(all);
    expect(all.indeterminate).toBe(false);
    expect(screen.getByRole('status').textContent).toBe('7 selected');

    await userEvent.click(all);
    expect(screen.getAllByRole('checkbox').every((c) => !(c as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('each checkbox is inside a 40px label target', () => {
    render(<InboxHarness rows={inbox} onPreview={vi.fn()} />);
    const label = screen.getByRole('checkbox', { name: 'Select Youssef Aziz' }).closest('label');
    expect(label?.className.split(' ')).toEqual(expect.arrayContaining(['min-h-10', 'pointer-coarse:min-h-11']));
  });
});

const bar = (action: BulkAction<object>) => (
  <BulkActionBar selectedIds={['a5']} selectedLabel="1" previewNote="" actions={[action]} onPreview={vi.fn()} />
);

describe('Scenario: A bulk action opens a preview, never a direct change', () => {
  // SAFETY: mutation check: called the action handler with [] instead of selectedIds -> failed
  it('hands the preview built from the selected ids to the caller and changes nothing', async () => {
    const onPreview = vi.fn();
    render(<InboxHarness rows={inbox} onPreview={onPreview} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Youssef Aziz' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Paolo Garcia' }));
    await userEvent.click(screen.getByRole('button', { name: 'Request evidence' }));

    expect(onPreview).toHaveBeenCalledExactlyOnceWith({ title: 'Preview: Request evidence', ids: ['a5', 'a6'] });
    // The selection stays, so cancelling the preview loses nothing.
    expect(screen.getByRole('status').textContent).toBe('2 selected');
  });

  // Proven by `pnpm typecheck`, which checks each @ts-expect-error.
  // SAFETY: mutation check: dropped `& { then?: never }` from BulkPreviewHandler -> tsc failed (unused @ts-expect-error)
  it('the handler type returns a preview; a mutation does not type-check', () => {
    const createRequest = vi.fn(async (_ids: readonly string[]) => {});
    // @ts-expect-error a handler that returns a promise is a direct change, not a preview
    bar({ id: 'x', label: 'Request evidence', preview: (ids) => createRequest(ids) });
    // @ts-expect-error a handler that returns nothing is a direct change, not a preview
    bar({ id: 'x', label: 'Request evidence', preview: (ids) => void createRequest(ids) });
    bar({ id: 'x', label: 'Request evidence', preview: (ids) => ({ ids }) });
    expect(createRequest).not.toHaveBeenCalled();
  });
});

describe('Scenario: Sorting is announced', () => {
  // SAFETY: mutation check: numeric columns sort ascending first -> failed; aria-sort removed -> failed
  it('activating "Backed score" sorts descending and sets aria-sort, a second press flips it', async () => {
    render(<InboxHarness rows={inbox} onPreview={vi.fn()} />);
    const header = screen.getByRole('columnheader', { name: 'Backed score' });
    expect(header.getAttribute('aria-sort')).toBe('none');

    await userEvent.click(within(header).getByRole('button', { name: 'Backed score' }));
    expect(header.getAttribute('aria-sort')).toBe('descending');
    expect(bodyNames()[0]).toBe('Youssef Aziz');
    expect(bodyNames().at(-1)).toBe('Paolo Garcia');

    await userEvent.keyboard('{Enter}');
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    expect(bodyNames()[0]).toBe('Paolo Garcia');
  });

  it('a text column sorts ascending first and only the active column carries a direction', async () => {
    render(<InboxHarness rows={inbox} onPreview={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Candidate' }));
    expect(screen.getByRole('columnheader', { name: 'Candidate' }).getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getByRole('columnheader', { name: 'Backed score' }).getAttribute('aria-sort')).toBe('none');
    expect(bodyNames()[0]).toBe('Anna Schmidt');
  });
});

describe('Scenario: Filter tabs show counts and work by keyboard', () => {
  const five = inbox.slice(0, 5);

  // SAFETY: mutation check: removed the ArrowRight handler -> failed; tabIndex 0 on every tab -> failed
  it('right arrow selects "Needs your action" and the table shows 2 rows', async () => {
    render(<InboxHarness rows={five} onPreview={vi.fn()} />);
    const group = screen.getByRole('toolbar', { name: 'Filter applications' });
    const names = within(group)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(names).toEqual(['All 5', 'Needs your action 2', 'Rubric not approved 1']);

    await userEvent.tab();
    expect(document.activeElement).toBe(within(group).getByRole('button', { name: 'All 5' }));
    await userEvent.keyboard('{ArrowRight}');

    const needs = within(group).getByRole('button', { name: 'Needs your action 2' });
    expect(needs.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(needs);
    expect(within(group).getByRole('button', { name: 'All 5' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2

    await userEvent.keyboard('{ArrowRight}{ArrowRight}'); // wraps to the start
    expect(within(group).getByRole('button', { name: 'All 5' }).getAttribute('aria-pressed')).toBe('true');

    await userEvent.tab(); // one Tab stop: the next Tab leaves the tabs
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Select all' }));
  });

  it('follows the reading direction in right-to-left', async () => {
    const onValueChange = vi.fn();
    render(
      <div dir="rtl">
        <FilterTabs
          label="Filter"
          value="b"
          onValueChange={onValueChange}
          tabs={[
            { value: 'a', label: 'A', count: 1 },
            { value: 'b', label: 'B', count: 1 },
          ]}
        />
      </div>,
    );
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');
    expect(onValueChange).toHaveBeenCalledWith('a');
  });
});

describe('Scenario: Empty, loading and error states', () => {
  const base = {
    caption: 'Applications',
    columns,
    getRowId: (r: Application) => r.id,
    emptyMessage: 'No applications yet.',
    selection: { selectedIds: [], onSelectedIdsChange: vi.fn(), allLabel: 'Select all', rowLabel: () => 'Select' },
  };

  it('no rows: the caller’s empty message and no header checkbox', () => {
    render(<DataTable {...base} rows={[]} />);
    expect(screen.getByText('No applications yet.')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  // SAFETY: mutation check: SKELETON_ROWS 5 -> 3 -> failed; dropped aria-busy -> failed
  it('loading: 5 skeleton rows with aria-busy="true"', () => {
    render(<DataTable {...base} rows={[]} loading />);
    const table = screen.getByRole('table', { name: 'Applications' });
    expect(table.getAttribute('aria-busy')).toBe('true');
    expect(within(screen.getAllByRole('rowgroup')[1] as HTMLElement).getAllByRole('row')).toHaveLength(5);
    expect(screen.queryByText('No applications yet.')).toBeNull();
  });

  it('error: "Could not load this list." with a "Try again" button', async () => {
    const onRetry = vi.fn();
    render(
      <DataTable
        {...base}
        rows={inbox}
        error={{ message: 'Could not load this list.', retryLabel: 'Try again', onRetry }}
      />,
    );
    expect(screen.getByText('Could not load this list.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByText('Youssef Aziz')).toBeNull();
    expect(screen.getByRole('table').hasAttribute('aria-busy')).toBe(false);
  });
});

describe('DataTable structure', () => {
  it('is a real table named by its caption, with column headers, in its own scroll box, with a footer slot', () => {
    render(
      <DataTable
        caption="Applications"
        columns={columns}
        rows={inbox}
        getRowId={(r) => r.id}
        emptyMessage=""
        footer={<button type="button">Show more</button>}
      />,
    );
    const table = screen.getByRole('table', { name: 'Applications' });
    expect(table.tagName).toBe('TABLE');
    expect(screen.getAllByRole('columnheader').map((h) => h.getAttribute('scope'))).toEqual(['col', 'col']);
    expect(table.parentElement?.className).toContain('overflow-auto');
    expect(table.querySelector('thead')?.className).toContain('sticky');
    expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy();
    // Without onSortChange or selection there are no sort buttons and no checkbox column.
    expect(screen.queryAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(within(screen.getAllByRole('row')[1] as HTMLElement).getAllByRole('cell')[1]?.className).toContain(
      'text-end',
    );
  });
});

// @vitest-environment jsdom
import { intlConfig } from '@aivera/i18n';
import { IntlProvider } from '@aivera/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WorkspaceRow, WorkspacesListView } from '../domain/workspaces.ts';
import { WorkspaceDetail } from './WorkspaceDetail.tsx';
import { WorkspacesList } from './WorkspacesList.tsx';

// AIV-P2-036: the workspaces list and detail, rendered with the console's translations. Synthetic names (personas.md).
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const show = (node: React.ReactNode) => render(<IntlProvider {...intl}>{node}</IntlProvider>);
const list = (table: WorkspacesListView['table'], search?: WorkspacesListView['search']) =>
  show(<WorkspacesList table={table} {...(search && { search })} />);

const row = (name: string, extra: Partial<WorkspaceRow> = {}): WorkspaceRow => ({
  id: `0190d4a2-0000-7000-8000-${name.length.toString().padStart(12, '0')}`,
  name,
  type: 'in_house',
  // 23:30 UTC on 18 Nov is 19 Nov in Dubai: the date is shown in the stated zone, not UTC.
  createdAt: new Date('2026-11-18T23:30:00Z'),
  synthetic: false,
  status: 'active',
  activeMembers: 1,
  jobs: 0,
  ai: { dailyBudget: 2_000_000, overridden: false, days: [{ day: '2026-11-25', tokens: 1_500 }] },
  ...extra,
});
const ready = (rows: WorkspaceRow[], searched = '', onPage = () => {}, page = 1, total = rows.length) =>
  ({ status: 'ready', rows, searched, page, pageCount: Math.max(1, Math.ceil(total / 50)), onPage }) as const;

describe('Scenario: Listing workspaces', () => {
  it('shows name, type, created date in its stated time zone, members, jobs, AI tokens today, status "Active", plan "No plan yet"', () => {
    list(
      ready([
        row('Demo Hiring Co', { synthetic: true, activeMembers: 3, jobs: 5 }),
        row('Gulf Talent Partners', { type: 'agency', activeMembers: 4, jobs: 2, ai: null }),
      ]),
    );
    const table = screen.getByRole('table', { name: 'Workspaces' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Workspace', 'Type', 'Created (Asia/Dubai)', 'Members', 'Jobs', 'AI tokens today', 'Status', 'Plan']);
    const [, demo, gulf] = within(table).getAllByRole('row');
    expect(
      within(demo as HTMLElement)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual([
      'Demo Hiring CoSynthetic',
      'In-house team',
      '19 Nov 2026',
      '3',
      '5',
      '1,500Observed',
      'Active',
      'No plan yet',
    ]);
    expect(within(gulf as HTMLElement).getAllByRole('cell')[1]?.textContent).toBe('Agency');
    // AIV-P2-038 Scenario: Usage not available: the store could not be read for this workspace.
    expect(within(gulf as HTMLElement).getAllByRole('cell')[5]?.textContent).toBe('Not yet available');
    expect(screen.getByRole('link', { name: 'Gulf Talent Partners' }).getAttribute('href')).toMatch(
      /^\/ops\/workspaces\/[0-9a-f-]{36}$/,
    );
  });

  it('pages 50 at a time: "Page 1 of 2", Previous disabled, Next asks for page 2', async () => {
    const onPage = vi.fn();
    list(ready([row('Demo Hiring Co')], '', onPage, 1, 51));
    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous page' }).hasAttribute('disabled')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it('one page needs no pager', () => {
    list(ready([row('Demo Hiring Co')]));
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
  });
});

describe('Scenario: Searching by name', () => {
  it('typing and pressing Enter searches with the typed name', async () => {
    const onSearch = vi.fn();
    const onQueryChange = vi.fn();
    list(ready([]), { query: 'gulf', onQueryChange, onSearch });
    const box = screen.getByRole('searchbox', { name: 'Search by workspace name' });
    await userEvent.type(box, 'x{Enter}');
    expect(onQueryChange).toHaveBeenCalledWith('gulfx');
    expect(onSearch).toHaveBeenCalledOnce();
  });
});

describe('Scenario Outline: States', () => {
  it('no workspace exists: "No workspaces yet."', () => {
    list(ready([]));
    expect(screen.getByText('No workspaces yet.')).toBeTruthy();
  });

  it('the search matches nothing: No workspace matches "zzz".', () => {
    list(ready([], 'zzz'));
    expect(screen.getByText('No workspace matches "zzz".')).toBeTruthy();
  });

  it('the request is slow: "Loading workspaces…" and a busy table', () => {
    list({ status: 'loading' });
    expect(screen.getByRole('status').textContent).toBe('Loading workspaces…');
    expect(screen.getByRole('table', { name: 'Workspaces' }).getAttribute('aria-busy')).toBe('true');
  });

  it('the request fails: "We could not load workspaces. Try again." and a retry', async () => {
    const onRetry = vi.fn();
    list({ status: 'error', onRetry });
    expect(screen.getByRole('alert').textContent).toBe('We could not load workspaces. Try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('Scenario: Opening a workspace', () => {
  it('shows type "Agency", 4 members, 2 jobs and "No operator actions yet."', () => {
    show(<WorkspaceDetail workspace={row('Gulf Talent Partners', { type: 'agency', activeMembers: 4, jobs: 2 })} />);
    const facts = Object.fromEntries(
      screen.getAllByRole('term').map((term) => [term.textContent, term.nextElementSibling?.textContent]),
    );
    expect(facts).toEqual({
      Type: 'Agency',
      'Created (Asia/Dubai)': '19 Nov 2026',
      Members: '4',
      Jobs: '2',
      Status: 'Active',
      Plan: 'No plan yet',
    });
    expect(screen.getByRole('heading', { level: 2, name: 'Operator actions' })).toBeTruthy();
    expect(screen.getByText('No operator actions yet.')).toBeTruthy();
    expect(screen.queryByText('Synthetic')).toBeNull();
  });
});

// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { JobRow } from '../domain/jobsList.ts';
import { JobsList, type JobsListView } from './JobsList.tsx';

afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const show = (view: JobsListView) =>
  render(
    <IntlProvider {...intl}>
      <JobsList view={view} />
    </IntlProvider>,
  );

describe('Scenario: Loading and error', () => {
  it('a slow request shows a table skeleton', () => {
    show({ status: 'loading' });
    expect(screen.getByRole('table', { name: 'Jobs' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Loading jobs…');
  });

  it('a failed request says so and retries', async () => {
    const onRetry = vi.fn();
    show({ status: 'error', onRetry });
    expect(screen.getByRole('alert').textContent).toBe('We could not load your jobs. Try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('Rows', () => {
  it('an approved job shows its assessed count as observed and coverage as "Not yet available" (AGENTS.md 1.7)', () => {
    show({
      status: 'ready',
      total: 1,
      filter: 'all',
      counts: { all: 1, needsAction: 0, rubricNotApproved: 0 },
      onFilterChange: () => {},
      rows: [
        {
          id: 'j1',
          title: 'QA Automation Engineer',
          team: 'Quality',
          location: 'Dubai, hybrid',
          stage: 'collecting_evidence',
          rubric: { approved: true, latest: 'approved' },
          assessed: 64,
          coveragePercent: null,
          nextAction: { kind: 'chase_evidence', count: 2 },
          hiringOwner: null,
          client: null,
          clientId: null,
        },
      ],
      clients: null,
      client: '',
      onClientChange: () => {},
    });
    const [, row] = screen.getAllByRole('row');
    const cells = within(row as HTMLElement).getAllByRole('cell');
    expect(cells.map((cell) => cell.textContent)).toEqual([
      'QA Automation EngineerQuality · Dubai, hybrid',
      'Not assigned',
      'Collecting evidence',
      '64Observed',
      'Not yet available',
      'Approved',
      'Chase 2 evidence requests',
    ]);
  });
});

describe("AIV-P1-056: an agency sees each job's client", () => {
  it('shows a Client column, "Our team" for its own jobs, and a client filter', async () => {
    const onClientChange = vi.fn();
    const job = {
      title: 'Staff Backend Engineer',
      team: null,
      location: null,
      stage: 'defining_rubric',
      rubric: { approved: false, latest: 'draft' },
      assessed: 0,
      coveragePercent: null,
      nextAction: null,
      hiringOwner: 'Faisal Client',
    } as const;
    show({
      status: 'ready',
      total: 2,
      filter: 'all',
      counts: { all: 2, needsAction: 0, rubricNotApproved: 2 },
      onFilterChange: () => {},
      rows: [
        { ...job, id: 'j1', client: 'Dune Logistics', clientId: 'c1' },
        { ...job, id: 'j2', title: 'Recruitment Coordinator', client: null, clientId: null },
      ],
      clients: [{ id: 'c1', name: 'Dune Logistics' }],
      client: '',
      onClientChange,
    });
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toContain('Client');
    const [, first, second] = screen.getAllByRole('row');
    expect(within(first as HTMLElement).getAllByRole('cell')[1]?.textContent).toBe('Dune Logistics');
    expect(within(second as HTMLElement).getAllByRole('cell')[1]?.textContent).toBe('Our team');
    await userEvent.selectOptions(screen.getByLabelText('Client'), 'Dune Logistics');
    // AIV-P1-165: the filter works by the client's opaque id, which is what the URL carries.
    expect(onClientChange).toHaveBeenCalledWith('c1');
  });
});

// AIV-P1-101: one approved job, as an admin or recruiter (canImport) or anyone else.
const withImport = (canImport: boolean, more: Partial<JobRow> = {}) =>
  render(
    <IntlProvider {...intl}>
      <JobsList
        canImport={canImport}
        view={{
          status: 'ready',
          total: 1,
          filter: 'all',
          counts: { all: 1, needsAction: 0, rubricNotApproved: 0 },
          onFilterChange: () => {},
          rows: [
            {
              id: '0190d4a2-0000-7000-9000-000000001031',
              title: 'Senior AI Engineer',
              team: null,
              location: null,
              stage: 'round_1',
              rubric: { approved: true, latest: 'approved' },
              assessed: 64,
              coveragePercent: null,
              nextAction: null,
              hiringOwner: null,
              client: null,
              clientId: null,
              ...more,
            },
          ],
          clients: null,
          client: '',
          onClientChange: () => {},
        }}
      />
    </IntlProvider>,
  );

describe('AIV-P1-101, AIV-P1-165: "Add CVs" on each row', () => {
  it("links an admin or recruiter to the job's Add CVs page, by its opaque id", () => {
    withImport(true);
    expect(screen.getByRole('link', { name: 'Add CVs' }).getAttribute('href')).toBe(
      '/app/jobs/0190d4a2-0000-7000-9000-000000001031/import',
    );
  });

  it('is not offered to a hiring owner or interviewer', () => {
    withImport(false);
    expect(screen.queryByRole('link', { name: 'Add CVs' })).toBeNull();
  });
});

describe('AIV-P1-165 Scenario: The next action is the button', () => {
  it('an approved job with no candidates: the cell is the "Add CVs" button, and the count is "0" with no chip', () => {
    withImport(true, { assessed: 0 });
    const cells = within(screen.getAllByRole('row')[1] as HTMLElement).getAllByRole('cell');
    expect(cells.at(-1)?.textContent).toBe('Add CVs');
    expect(cells[3]?.textContent).toBe('0');
  });

  it('a rubric to approve: the button is "Approve the rubric", opening the rubric page, and nothing else', () => {
    withImport(true, { rubric: { approved: false, latest: 'draft' }, nextAction: { kind: 'approve_rubric' } });
    expect(screen.getByRole('link', { name: 'Approve the rubric' }).getAttribute('href')).toBe(
      '/app/jobs/0190d4a2-0000-7000-9000-000000001031/rubric',
    );
    expect(screen.queryByRole('link', { name: 'Add CVs' })).toBeNull();
  });
});

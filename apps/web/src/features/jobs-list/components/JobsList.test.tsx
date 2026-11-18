// @vitest-environment jsdom
import { intlConfig } from '@aivera/i18n';
import { IntlProvider } from '@aivera/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
    expect(screen.getByRole('status').textContent).toBe('Loading jobs');
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
  it('an approved job shows "Not yet available" with its marker where no source exists yet (AGENTS.md 1.7)', () => {
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
          assessed: null,
          coveragePercent: null,
          nextAction: { kind: 'chase_evidence', count: 2 },
          hiringOwner: null,
        },
      ],
    });
    const [, row] = screen.getAllByRole('row');
    const cells = within(row as HTMLElement).getAllByRole('cell');
    expect(cells.map((cell) => cell.textContent)).toEqual([
      'QA Automation EngineerQuality · Dubai, hybrid',
      'Not assigned',
      'Collecting evidence',
      'Not yet available',
      'Not yet available',
      'Approved',
      'Chase 2 evidence requests',
    ]);
  });
});

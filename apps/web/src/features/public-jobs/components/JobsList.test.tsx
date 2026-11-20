// @vitest-environment jsdom
import { intlConfig } from '@aivera/i18n';
import { IntlProvider } from '@aivera/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { JobsList, JobsListFailed, JobsListLoading, type JobsListProps } from './JobsList.tsx';

afterEach(cleanup); // Vitest globals are off, so Testing Library cannot register its own cleanup.

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const props: JobsListProps = {
  q: '',
  filter: 'all',
  chips: [
    { value: 'all', count: 5 },
    { value: 'engineering', count: 3 },
    { value: 'sales', count: 1 },
  ],
  jobs: [
    {
      slug: 'real-estate-sales-consultant-3f9a1c0b2d4e',
      title: 'Real Estate Sales Consultant',
      descriptor: 'A property brokerage',
      location: 'Dubai',
      jobTypeLabel: 'Sales',
      postedDays: 2,
    },
  ],
  page: 1,
  pageCount: 1,
  onFilterChange: () => {},
};
const withIntl = (ui: ReactNode) => render(<IntlProvider {...intl}>{ui}</IntlProvider>);
const renderList = (more: Partial<JobsListProps> = {}) => withIntl(<JobsList {...props} {...more} />);

describe('JobsList (AIV-P3-004)', () => {
  it('shows the intro, the chips with counts and each card, with no fit badge for free visitors', () => {
    renderList();
    expect(
      screen.getByText('Posted by recruiters who hire on evidence. Every listing shows what the job needs.'),
    ).toBeDefined();
    const chips = within(screen.getByRole('radiogroup', { name: 'Filter jobs' }));
    expect(chips.getByRole('radio', { name: 'All 5' })).toHaveProperty('checked', true);
    expect(chips.getByRole('radio', { name: 'Engineering 3' })).toBeDefined();
    const card = within(screen.getByRole('listitem'));
    expect(card.getByRole('heading', { level: 2, name: 'Real Estate Sales Consultant' })).toBeDefined();
    expect(card.getByText('A property brokerage · Dubai')).toBeDefined();
    expect(card.getByText('Sales')).toBeDefined();
    expect(card.getByText('Posted 2 days ago')).toBeDefined();
    expect(card.getByRole('link', { name: 'View job: Real Estate Sales Consultant' })).toHaveProperty(
      'pathname',
      '/candidates/jobs/real-estate-sales-consultant-3f9a1c0b2d4e',
    );
    expect(screen.queryByText(/You meet/)).toBeNull();
  });

  it('a chip chosen with the keyboard reports its value', async () => {
    const onFilterChange = vi.fn();
    renderList({ onFilterChange });
    screen.getByRole('radio', { name: 'All 5' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onFilterChange).toHaveBeenCalledWith('engineering');
  });

  it('no results: the message and a Clear filters link back to the full list; the search keeps its filter', () => {
    renderList({ jobs: [], q: 'Pastry chef', filter: 'engineering' });
    expect(screen.getByText('No jobs match. Try a different word or clear the filters.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Clear filters' })).toHaveProperty('pathname', '/candidates/jobs');
    expect(screen.getByRole('searchbox', { name: 'Job title or skill' })).toHaveProperty('value', 'Pastry chef');
    expect(document.querySelector('input[type=hidden][name=filter]')).toHaveProperty('value', 'engineering');
  });

  it('pages: Previous and Next keep the search and filter', () => {
    renderList({ q: 'AI', filter: 'engineering', page: 2, pageCount: 3 });
    const pages = within(screen.getByRole('navigation', { name: 'Pages' }));
    expect(pages.getByRole('link', { name: 'Previous page' })).toHaveProperty('search', '?q=AI&filter=engineering');
    expect(pages.getByRole('link', { name: 'Next page' })).toHaveProperty('search', '?q=AI&filter=engineering&page=3');
    expect(pages.getByText('Page 2 of 3')).toBeDefined();
  });

  it('loading: the heading and intro stay, and the list is announced as loading', () => {
    withIntl(<JobsListLoading />);
    expect(screen.getByRole('heading', { level: 1, name: 'Jobs' })).toBeDefined();
    expect(screen.getByText('Loading jobs')).toBeDefined();
  });

  it('failed: the message is an alert, and Try again retries', async () => {
    const onRetry = vi.fn();
    withIntl(<JobsListFailed onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toBe('Jobs could not load. Try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('a chip waiting for the server marks the list busy', () => {
    renderList({ pending: true });
    expect(screen.getByRole('list').getAttribute('aria-busy')).toBe('true');
  });
});

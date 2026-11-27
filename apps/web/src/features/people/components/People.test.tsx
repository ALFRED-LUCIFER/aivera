// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { toPeople } from '../domain/people.ts';
import { People, type PeopleView } from './People.tsx';

// AIV-P1-048: the states the e2e spec does not reach (loading, error, and a person in two jobs, which the e2e seed
// does not have). Synthetic cast only (docs/00-product/personas.md).
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const show = (view: PeopleView) =>
  render(
    <IntlProvider {...intl}>
      <People view={view} />
    </IntlProvider>,
  );

const score = (backedScore: number) => ({
  rank: 1,
  backedScore,
  upperBound: backedScore + 16,
  meetsNeed: 4,
  competencyCount: 6,
  confidence: 'High' as const,
  assessedAt: new Date('2026-11-14T08:00:00.000Z'),
  missing: [],
  investigate: [],
});
const sara = (id: string, backed: number) => ({
  id,
  personId: 'p-sara',
  name: 'Sara Al Qahtani',
  stage: 'new' as const,
  score: score(backed),
});
const data = toPeople([
  { id: 'j-ai', title: 'Senior AI Engineer', rows: [sara('a1', 68)] },
  { id: 'j-be', title: 'Staff Backend Engineer', rows: [sara('a2', 46)] },
]);
const ready = (): PeopleView => ({ status: 'ready', data, tab: 'all', rows: data.people, onTabChange: vi.fn() });

describe('People', () => {
  it('says it is loading', () => {
    show({ status: 'loading' });
    expect(screen.getByRole('status').textContent).toContain('Loading candidates…');
  });

  it('says a failed read failed, and retries', async () => {
    const onRetry = vi.fn();
    show({ status: 'error', onRetry });
    expect(screen.getByRole('alert').textContent).toContain('We could not load your candidates. Try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows the empty state with "Add a job" and no tabs', () => {
    show({ status: 'ready', data: { jobs: [], people: [] }, tab: 'all', rows: [], onTabChange: vi.fn() });
    expect(screen.getByText('No one in a live process yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add a job' }).getAttribute('href')).toBe('/app/jobs/new');
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('lists a person in two jobs once, with "In 2 jobs" opening the other job', async () => {
    show(ready());
    const row = screen.getByRole('row', { name: /Sara Al Qahtani/ });
    expect(within(row).getByText('Senior AI Engineer')).toBeTruthy();
    expect(within(row).getByRole('link', { name: 'Sara Al Qahtani' }).getAttribute('href')).toBe(
      '/app/candidates/p-sara?job=j-ai',
    );
    await userEvent.click(within(row).getByText('In 2 jobs'));
    expect(
      within(row).getByText('Staff Backend Engineer · New · 46 backed by evidence · up to 62 if claims hold'),
    ).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'All jobs 1' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Staff Backend Engineer 1' })).toBeTruthy();
  });
});

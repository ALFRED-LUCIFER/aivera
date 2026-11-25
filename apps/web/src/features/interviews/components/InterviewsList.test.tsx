// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { InterviewRow } from '../domain/interviews.ts';
import { InterviewsList, type InterviewsListView } from './InterviewsList.tsx';

afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const show = (view: InterviewsListView) =>
  render(
    <IntlProvider {...intl}>
      <InterviewsList view={view} />
    </IntlProvider>,
  );

// The Interviews artboard's rows on 18 Nov 2026 (synthetic cast, personas.md). Times are Gulf time.
const row = (over: Partial<InterviewRow>): InterviewRow => ({
  id: 'i1',
  candidate: 'Daniel Novak',
  job: 'Senior AI Engineer',
  round: 'structured_screen',
  interviewer: null,
  scheduledAt: '2026-11-18T10:00:00.000Z',
  today: true,
  status: 'in_progress',
  dueDays: null,
  competencies: ['Retrieval and evaluation', 'Cost and reliability'],
  ...over,
});
const daniel = row({});
const karim = row({
  id: 'i2',
  candidate: 'Karim Nasser',
  job: 'Senior Product Manager, Payments',
  round: 'evidence_defence',
  interviewer: 'CPO, Payments',
  scheduledAt: '2026-11-21T07:00:00.000Z',
  today: false,
  status: 'scheduled',
  competencies: ['Prioritisation'],
});
const anjali = row({
  id: 'i3',
  candidate: 'Anjali Iyer',
  job: 'Senior Product Manager, Payments',
  scheduledAt: '2026-11-16T07:00:00.000Z',
  today: false,
  status: 'scorecard_due',
  dueDays: 2,
  competencies: ['Working with engineering and design'],
});

const ready = (over: Partial<Extract<InterviewsListView, { status: 'ready' }>> = {}): InterviewsListView => ({
  status: 'ready',
  view: 'ongoing',
  onViewChange: () => {},
  rows: [daniel, karim, anjali],
  counts: { ongoing: 3, completed: 0 },
  people: 0,
  jobs: 0,
  ...over,
});

const cellsOf = (name: string) =>
  within(screen.getByText(name).closest('tr') as HTMLElement)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);

describe('Scenario: Ongoing interviews', () => {
  it('Daniel Novak\'s row reads as the artboard does, with the signed-in member as "You"', () => {
    show(ready());
    expect(cellsOf('Daniel Novak')).toEqual([
      'Daniel NovakSenior AI Engineer',
      'Round 1, structured screen',
      'You',
      'Today, 14:00',
      'In progress',
      'Retrieval and evaluation, Cost and reliability',
      'Open scorecard',
    ]);
  });

  it("Karim Nasser's Round 2 names its interviewer and its time in the workspace time zone", () => {
    show(ready());
    expect(cellsOf('Karim Nasser').slice(1, 5)).toEqual([
      'Round 2, evidence defence',
      'CPO, Payments',
      '21 Nov, 11:00',
      'Scheduled',
    ]);
  });

  it('the tabs carry each count', () => {
    show(ready({ counts: { ongoing: 5, completed: 14 } }));
    expect(screen.getByRole('radio', { name: 'Ongoing 5' })).toHaveProperty('checked', true);
    expect(screen.getByRole('radio', { name: 'Completed 14' })).toHaveProperty('checked', false);
  });
});

describe('Row action by status', () => {
  it('in progress: "Open scorecard" links to the interview', () => {
    show(ready());
    expect(screen.getByRole('link', { name: 'Open scorecard' }).getAttribute('href')).toBe('/app/interviews/i1');
    // The in-progress and the overdue rows link; a scheduled row does not.
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('Scenario: Overdue scorecard: status "Scorecard due", the day alone and "Scorecard due, 2 days"', () => {
    show(ready());
    expect(cellsOf('Anjali Iyer').slice(3)).toEqual([
      '16 Nov',
      'Scorecard due',
      'Working with engineering and design',
      'Scorecard due, 2 days',
    ]);
    // Nothing moves an interview to in progress yet, so the overdue row is how its scorecard is reached.
    const due = screen.getByRole('link', { name: 'Scorecard due, 2 days' });
    expect(due.getAttribute('href')).toMatch(/^\/app\/interviews\/./);
  });

  // SAFETY: mutation check: returned "Guide ready" for a scheduled row -> this test failed
  it('scheduled: never "Guide ready" while no guide exists (AIV-P2-003); it says "No guide yet"', () => {
    show(ready());
    expect(cellsOf('Karim Nasser').at(-1)).toBe('No guide yet');
    expect(screen.queryByText('Guide ready')).toBeNull();
  });

  it('no time yet and completed: no action', () => {
    const unscheduled = row({
      id: 'i4',
      candidate: 'Omar Al Suwaidi',
      scheduledAt: null,
      today: false,
      status: 'to_schedule',
    });
    const done = row({ id: 'i5', candidate: 'Sara Al Qahtani', today: false, status: 'completed' });
    show(ready({ rows: [unscheduled, done] }));
    expect(cellsOf('Omar Al Suwaidi').slice(3)).toEqual([
      'No time yet',
      'Not scheduled yet',
      'Retrieval and evaluation, Cost and reliability',
      '',
    ]);
    expect(cellsOf('Sara Al Qahtani').slice(4)).toEqual([
      'Completed',
      'Retrieval and evaluation, Cost and reliability',
      '',
    ]);
  });

  it('every status badge has an icon beside its word, never colour alone', () => {
    show(ready());
    for (const word of ['In progress', 'Scheduled', 'Scorecard due'])
      expect(screen.getByText(word, { selector: 'span' }).querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('Scenario: Completed tab and summary', () => {
  it('choosing "Completed" reports the view', async () => {
    const onViewChange = vi.fn();
    show(ready({ onViewChange, counts: { ongoing: 3, completed: 14 } }));
    await userEvent.click(screen.getByRole('radio', { name: 'Completed 14' }));
    expect(onViewChange).toHaveBeenCalledWith('completed');
  });

  it('the summary counts interviews, people and jobs, and states its basis (AGENTS.md 1.7)', () => {
    show(ready({ counts: { ongoing: 5, completed: 14 }, people: 9, jobs: 2 }));
    const summary = screen.getByText('14 interviews completed with 9 people across 2 jobs so far.');
    expect(within(summary).getByText('Observed')).toBeTruthy();
  });

  it('one of each is singular, and nothing completed shows no summary', () => {
    show(ready({ counts: { ongoing: 0, completed: 1 }, people: 1, jobs: 1 }));
    expect(screen.getByText('1 interview completed with 1 person across 1 job so far.')).toBeTruthy();
    cleanup();
    show(ready());
    expect(screen.queryByText(/so far\.$/)).toBeNull();
  });
});

describe('Scenario: Empty state', () => {
  it('a workspace with no interviews says where they come from', () => {
    show(ready({ rows: [], counts: { ongoing: 0, completed: 0 } }));
    expect(
      screen.getByText('No interviews yet. Interviews are scheduled from a job’s ranking or decision pack.'),
    ).toBeTruthy();
  });

  it('an empty tab beside a full one says only that', () => {
    show(ready({ view: 'completed', rows: [], counts: { ongoing: 3, completed: 0 } }));
    expect(screen.getByText('No completed interviews yet.')).toBeTruthy();
  });
});

describe('Scenario: Loading and error', () => {
  it('skeleton rows with an accessible "Loading interviews…" status', () => {
    show({ status: 'loading' });
    expect(screen.getByRole('table', { name: 'Interviews' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Loading interviews…');
  });

  it('a failed request says so and retries', async () => {
    const onRetry = vi.fn();
    show({ status: 'error', onRetry });
    expect(screen.getByRole('alert').textContent).toBe('We could not load the interviews. Try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

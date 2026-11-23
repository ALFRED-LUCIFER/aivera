// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RankingTable, type RankingTableView } from '@/features/ranking/components/RankingTable.tsx';
import type { CandidateRow } from '@/features/ranking/domain/ranking.ts';
import { Ranking } from './Ranking.tsx';

// AIV-P1-034: the ranked table with its controller, as the page renders it. Synthetic cast only (docs/00-product/personas.md).
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const JOB = '0190d4a2-0000-7000-9000-000000001031';
// 22:30 UTC is 15 Nov in Dubai: the workspace time zone decides the day.
const assessedAt = new Date('2026-11-14T22:30:00.000Z');
const scoredRow = (n: number, name: string, backed: number, upTo: number, missing: string[]): CandidateRow => ({
  id: `a${n}`,
  name,
  stage: 'new',
  score: {
    rank: n,
    backedScore: backed,
    upperBound: upTo,
    meetsNeed: 4,
    competencyCount: 6,
    confidence: n === 1 ? 'High' : 'Low',
    missing,
    assessedAt,
  },
});
const nine = [
  scoredRow(1, 'Sara Al Qahtani', 68, 84, ['Product judgement']),
  scoredRow(2, 'Arjun Menon', 64, 76, ['Retrieval and evaluation']),
  scoredRow(3, 'Layla Haddad', 61, 82, ['Retrieval and evaluation']),
  ...['Daniel Novak', 'Priya Nair', 'Omar Al Suwaidi', 'Maria Santos', 'Youssef Aziz'].map((name, i) =>
    scoredRow(i + 4, name, 50 - i * 5, 60, []),
  ),
  { id: 'a9', name: 'Huda Rahman', stage: 'new', score: null } satisfies CandidateRow,
];

const showRanking = (rows: CandidateRow[], awaitingRubric = false) =>
  render(
    <IntlProvider {...intl}>
      <Ranking jobId={JOB} awaitingRubric={awaitingRubric} rows={rows} />
    </IntlProvider>,
  );
const show = (view: RankingTableView) =>
  render(
    <IntlProvider {...intl}>
      <RankingTable view={view} />
    </IntlProvider>,
  );
const table = () => screen.getByRole('table', { name: 'Ranked candidates' });
const bodyRows = () => within(table()).getAllByRole('row').slice(1);

describe('Scenario: The ranking for Senior AI Engineer', () => {
  it('row 1 shows rank, name, stage, "68" with "up to 84 if claims hold", "4 of 6", High, the missing evidence and the date', () => {
    showRanking(nine);
    expect(
      within(table())
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual([
      '#',
      'Candidate',
      'Backed score',
      "Meets the job's need",
      'Confidence',
      'Missing critical evidence',
      'Last scored (Asia/Dubai)',
      'Next action',
    ]);
    expect(bodyRows()[0]?.textContent).toBe(
      '1Sara Al QahtaniNew68up to 84 if claims hold4 of 6HighProduct judgement15 NovNot yet available',
    );
    // The bar's text equivalent is the full caption.
    expect(screen.getByRole('img', { name: '68 backed by evidence · up to 84 if claims hold' })).toBeTruthy();
  });

  it('the first 7 rows show, the footer counts them, and "Show all 9" lists everyone, the unscored last', async () => {
    showRanking(nine);
    expect(bodyRows()).toHaveLength(7);
    expect(
      screen.getByText('Showing 7 of 8 assessed. Ranking orders your attention. Nobody is rejected automatically.'),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Show all 9' }));
    expect(bodyRows()).toHaveLength(9);
    expect(bodyRows()[8]?.textContent).toMatch(/^Huda RahmanNewNot yet scoredNot yet available/);
    expect(screen.queryByRole('button', { name: /^Show all/ })).toBeNull();
  });

  it('a score with no open claims reads only its backed value', () => {
    showRanking([scoredRow(1, 'Sara Al Qahtani', 72, 72, [])]);
    expect(screen.getByRole('img', { name: '72 backed by evidence' })).toBeTruthy();
    expect(bodyRows()[0]?.textContent).toContain('None');
  });

  it('several missing competencies are separated by "; ", as the artboard does', () => {
    showRanking([scoredRow(1, 'Sara Al Qahtani', 68, 84, ['Product judgement', 'Retrieval and evaluation'])]);
    expect(screen.getByText('Product judgement; Retrieval and evaluation')).toBeTruthy();
  });
});

describe('Scenario: Filter by missing evidence', () => {
  it('"Retrieval and evaluation" lists Arjun and Layla, and Sara is not listed', async () => {
    showRanking(nine);
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Missing evidence' }),
      'Missing evidence: Retrieval and evaluation',
    );
    expect(bodyRows().map((r) => within(r).getAllByRole('cell')[1]?.textContent)).toEqual([
      'Arjun MenonNew',
      'Layla HaddadNew',
    ]);
  });

  it('search narrows by name, and no match says so', async () => {
    showRanking(nine);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search candidates' }), 'zzz');
    expect(within(table()).getByText('No candidates match these filters.')).toBeTruthy();
  });

  // mutation check: `filtered` forced to false in the controller -> this test failed ("No one is assessed yet.")
  it('under a search the footer counts the matching rows and says so, never "No one is assessed"', async () => {
    showRanking(nine);
    const search = screen.getByRole('searchbox', { name: 'Search candidates' });
    await userEvent.type(search, 'Huda');
    expect(screen.getByText(/^None of these is assessed yet\. Ranking orders your attention/)).toBeTruthy();
    await userEvent.clear(search);
    await userEvent.type(search, 'Sara');
    expect(screen.getByText(/^Showing 1 of 1 assessed that match\./)).toBeTruthy();
  });

  it('the Columns menu hides a column and shows it again', async () => {
    showRanking(nine);
    await userEvent.click(screen.getByText('Columns'));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Confidence' }));
    expect(within(table()).queryByRole('columnheader', { name: 'Confidence' })).toBeNull();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Confidence' }));
    expect(within(table()).getByRole('columnheader', { name: 'Confidence' })).toBeTruthy();
  });
});

describe('Scenario: Job without an approved rubric', () => {
  it('says "Starts after rubric approval" with a link "Send rubric for approval" to the rubric, and keeps applicants listed', () => {
    showRanking([{ id: 'a9', name: 'Huda Rahman', stage: 'new', score: null }], true);
    expect(screen.getByText('Starts after rubric approval')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Send rubric for approval' }).getAttribute('href')).toBe(
      `/app/jobs/${JOB}/rubric`,
    );
    expect(bodyRows()[0]?.textContent).toMatch(/^Huda Rahman/);
    expect(screen.getByText(/^No one is assessed yet\. Ranking orders your attention/)).toBeTruthy();
  });
});

describe('Scenario: Empty, loading and error', () => {
  it('a job with no applicants says how ranking starts, with no filters or footer', () => {
    showRanking([]);
    expect(screen.getByText(/^No ranking yet\./)).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByText(/nobody is rejected automatically/)).toBeNull();
  });

  it('a slow read shows skeleton rows', () => {
    show({ status: 'loading' });
    expect(table().getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Loading the ranking…');
  });

  it('a failed read says "We could not load the ranking. Try again." and retries', async () => {
    const onRetry = vi.fn();
    show({ status: 'error', onRetry });
    expect(screen.getByRole('alert').textContent).toBe('We could not load the ranking. Try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

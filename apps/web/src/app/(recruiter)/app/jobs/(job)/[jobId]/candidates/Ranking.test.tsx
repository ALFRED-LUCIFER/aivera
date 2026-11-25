// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useReducer } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RankingTable, type RankingTableView } from '@/features/ranking/components/RankingTable.tsx';
import type { RowDuplicates } from '@/features/ranking/domain/duplicates.ts';
import type { CandidateRow } from '@/features/ranking/domain/ranking.ts';
import type { BulkActionId } from '@/features/ranking/domain/selection.ts';
import { Ranking } from './Ranking.tsx';

// AIV-P1-034: the ranked table with its controller, as the page renders it. Synthetic cast only (docs/00-product/personas.md).
// The merge and undo server actions (AIV-P1-018) are faked: these tests check what is shown and sent.
const fake = vi.hoisted(() => ({
  merge: vi.fn(),
  choose: vi.fn(),
  undo: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  urlListeners: new Set<() => void>(),
}));
// As Next does, useSearchParams follows window.history.replaceState, which is how the selection is kept (AIV-P1-036).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: fake.refresh, push: fake.push }),
  useSearchParams: () => {
    const [, changed] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
      fake.urlListeners.add(changed);
      return () => void fake.urlListeners.delete(changed);
    }, []);
    return new URLSearchParams(window.location.search);
  },
}));
const replaceState = window.history.replaceState.bind(window.history);
window.history.replaceState = (...args) => {
  replaceState(...args);
  act(() => fake.urlListeners.forEach((listener) => listener()));
};
vi.mock('@/features/ranking/services/mergeDuplicates.ts', () => ({ mergeDuplicate: fake.merge, undoMerge: fake.undo }));
vi.mock('@/features/ranking/services/chooseForInterview.ts', () => ({ chooseForInterview: fake.choose }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  replaceState(null, '', '/');
});

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const JOB = '0190d4a2-0000-7000-9000-000000001031';
// 22:30 UTC is 15 Nov in Dubai: the workspace time zone decides the day.
const assessedAt = new Date('2026-11-14T22:30:00.000Z');
const scoredRow = (n: number, name: string, backed: number, upTo: number, missing: string[]): CandidateRow => ({
  id: `a${n}`,
  personId: `p${n}`,
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
    investigate: missing,
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
  { id: 'a9', personId: 'p9', name: 'Huda Rahman', stage: 'new', score: null } satisfies CandidateRow,
];

const showRanking = (rows: CandidateRow[], awaitingRubric = false, bulkActions: BulkActionId[] = []) =>
  render(
    <IntlProvider {...intl}>
      <Ranking jobId={JOB} awaitingRubric={awaitingRubric} rows={rows} bulkActions={bulkActions} />
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
    // AIV-P1-043: the name opens the candidate's profile for this job.
    expect(screen.getByRole('link', { name: 'Sara Al Qahtani' }).getAttribute('href')).toBe(
      `/app/candidates/p1?job=${JOB}`,
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
    showRanking([{ id: 'a9', personId: 'p9', name: 'Huda Rahman', stage: 'new', score: null }], true);
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

const OMAR_1 = '0190d4a2-0000-7000-8000-0000000000a1';
const OMAR_2 = '0190d4a2-0000-7000-8000-0000000000a2';
const MERGE = '0190d4a2-0000-7000-8000-0000000000b1';
const possibleOmar: RowDuplicates = {
  personId: OMAR_2,
  mergedCount: 0,
  undo: null,
  possible: {
    personId: OMAR_1,
    name: 'Omar Al Suwaidi',
    reason: 'same_name',
    survivor: {
      name: 'Omar Al Suwaidi',
      applications: [{ job: 'Staff Backend Engineer', stage: 'in_process', sources: ['linkedin'], keepsStage: null }],
      evidenceSources: 2,
    },
    merged: {
      name: 'Omar Alsuwaidi',
      applications: [
        { job: 'Senior AI Engineer', stage: 'new', sources: ['email'], keepsStage: null },
        { job: 'Staff Backend Engineer', stage: 'new', sources: ['whatsapp'], keepsStage: 'in_process' },
      ],
      evidenceSources: 1,
    },
  },
};
const omarRow: CandidateRow = {
  id: 'a20',
  personId: OMAR_2,
  name: 'Omar Alsuwaidi',
  stage: 'new',
  score: null,
  duplicates: possibleOmar,
};

describe('Scenario: A likely duplicate needs a person (AIV-P1-018)', () => {
  it('the row shows "Possible duplicate of Omar Al Suwaidi." with "Merge?", and nothing is sent', () => {
    showRanking([omarRow]);
    expect(bodyRows()[0]?.textContent).toContain('Possible duplicate of Omar Al Suwaidi.Merge?');
    expect(fake.merge).not.toHaveBeenCalled();
  });

  it('rows without duplicates, and viewers who get none, show no prompt', () => {
    showRanking(nine);
    expect(screen.queryByText(/Possible duplicate/)).toBeNull();
    expect(screen.queryByText(/duplicates? merged/)).toBeNull();
  });
});

describe('Scenario: Merge preview', () => {
  // SAFETY: mutation check: dropped confirmDisabled from the merge card -> this test failed (Merge pressed with no reason)
  it('"Merge?" previews the applications, their stages, sources and evidence that combine and "Nothing is deleted"; Confirm sends the reason', async () => {
    fake.merge.mockResolvedValue({ ok: true });
    showRanking([omarRow]);
    await userEvent.click(screen.getByRole('button', { name: 'Merge?' }));
    const dialog = screen.getByRole('dialog', { name: 'Preview: merge Omar Alsuwaidi into Omar Al Suwaidi' });
    expect(dialog.textContent).toContain('Same name on both records.');
    expect(dialog.textContent).toContain(
      'Omar Al Suwaidi (stays)Staff Backend EngineerStage: In processLinkedIn2 evidence sources',
    );
    // A job both applied to keeps one application, at the stage of the one that stays.
    expect(dialog.textContent).toContain(
      'Omar Alsuwaidi (merged in)Senior AI EngineerStage: NewEmailStaff Backend EngineerStage: New. Both applied to ' +
        'this job: the applications combine at the stage of the one that stays, In process.WhatsApp1 evidence source',
    );
    expect(dialog.textContent).toContain('Nothing is deleted.');
    expect(dialog.textContent).toContain('Nothing changes until you confirm.');
    const confirm = within(dialog).getByRole('button', { name: 'Merge' });
    await userEvent.click(confirm);
    expect(fake.merge).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason, recorded in the audit log' }), 'Same CV');
    await userEvent.click(confirm);
    expect(fake.merge).toHaveBeenCalledExactlyOnceWith({ survivorId: OMAR_1, mergedId: OMAR_2, reason: 'Same CV' });
    expect(fake.refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Merged. Both records are now one candidate.')).toBeTruthy();
  });

  it('a refused merge says nothing was changed and keeps the preview open', async () => {
    fake.merge.mockResolvedValue({ ok: false, error: 'refused' });
    showRanking([omarRow]);
    await userEvent.click(screen.getByRole('button', { name: 'Merge?' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Reason, recorded in the audit log' }), 'Same CV');
    await userEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(screen.getByRole('alert').textContent).toBe('That did not go through. Nothing was changed. Try again.');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

const sneha = (undo: RowDuplicates['undo']): CandidateRow => ({
  id: 'a30',
  personId: OMAR_1,
  name: 'Sneha Iyer',
  stage: 'new',
  score: null,
  duplicates: { personId: OMAR_1, mergedCount: 2, undo, possible: null },
});

describe('Scenario: Exact duplicates merged, and undo for admins', () => {
  it('the row shows "2 duplicates merged"; with no undo to offer there is no "Undo merge"', () => {
    showRanking([sneha(null)]);
    expect(bodyRows()[0]?.textContent).toContain('2 duplicates merged');
    expect(screen.queryByRole('button', { name: 'Undo merge' })).toBeNull();
  });

  it('an admin undoes the newest merge with a reason, after the preview', async () => {
    fake.undo.mockResolvedValue({ ok: true });
    showRanking([sneha({ mergeId: MERGE, name: 'Sneha Iyer' })]);
    await userEvent.click(screen.getByRole('button', { name: 'Undo merge' }));
    const dialog = screen.getByRole('dialog', { name: 'Preview: undo the merge of Sneha Iyer' });
    expect(dialog.textContent).toContain('Sneha Iyer becomes a separate candidate again');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Two different people');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Undo merge' }));
    expect(fake.undo).toHaveBeenCalledExactlyOnceWith({ mergeId: MERGE, reason: 'Two different people' });
    expect(screen.getByText('Merge undone. Both people are separate again.')).toBeTruthy();
  });
});

// AIV-P1-036: a recruiter the server allows Compare (the `compare` flag is on).
const selectable = () => showRanking(nine, false, ['compare']);
const pick = (name: string) => userEvent.click(screen.getByRole('checkbox', { name: `Select ${name}` }));
const bar = () => screen.getByRole('region', { name: 'Bulk actions' });

describe('Scenario: Compare three (AIV-P1-036)', () => {
  it('three ticked rows show "3 selected", and "Compare" opens the comparison with those three person ids', async () => {
    selectable();
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull();
    for (const name of ['Layla Haddad', 'Sara Al Qahtani', 'Arjun Menon']) await pick(name);
    expect(within(bar()).getByRole('status').textContent).toBe('3 selected');
    expect(bar().textContent).toContain('Bulk actions always show a preview first.');
    // The selection is in the URL as opaque application ids; the comparison gets the person ids in rank order.
    expect(new URLSearchParams(window.location.search).get('selected')?.split(',').toSorted()).toEqual([
      'a1',
      'a2',
      'a3',
    ]);
    await userEvent.click(within(bar()).getByRole('button', { name: 'Compare' }));
    expect(fake.push).toHaveBeenCalledExactlyOnceWith(`/app/jobs/${JOB}/compare?ids=p1,p2,p3`);
  });

  it('the selection survives a filter and "Show all", and the bar says how many selected rows are not shown', async () => {
    selectable();
    await pick('Sara Al Qahtani');
    await pick('Arjun Menon');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search candidates' }), 'Sara');
    expect(within(bar()).getByRole('status').textContent).toBe('2 selected · 1 not shown in the table');
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search candidates' }));
    await userEvent.click(screen.getByRole('button', { name: 'Show all 9' }));
    expect(within(bar()).getByRole('status').textContent).toBe('2 selected');
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select Arjun Menon' }).checked).toBe(true);
  });

  it('a selection in the URL is restored, and ids that are not rows of this job are dropped', () => {
    replaceState(null, '', '/?selected=a2,not-a-row,a1');
    selectable();
    expect(within(bar()).getByRole('status').textContent).toBe('2 selected');
  });
});

describe('Scenario: Compare needs two or three (AIV-P1-036)', () => {
  it('with four selected "Compare" is disabled and reads "Compare up to 3 at a time"; with one, "Choose 2 or 3 to compare"', async () => {
    selectable();
    await pick('Sara Al Qahtani');
    const one = within(bar()).getByRole<HTMLButtonElement>('button', { name: 'Choose 2 or 3 to compare' });
    expect(one.disabled).toBe(true);
    for (const name of ['Arjun Menon', 'Layla Haddad', 'Daniel Novak']) await pick(name);
    expect(within(bar()).getByRole('status').textContent).toBe('4 selected');
    const four = within(bar()).getByRole<HTMLButtonElement>('button', { name: 'Compare up to 3 at a time' });
    expect(four.disabled).toBe(true);
    await userEvent.click(four);
    expect(fake.push).not.toHaveBeenCalled();
    expect(within(bar()).queryByRole('button', { name: 'Compare' })).toBeNull();
  });
});

describe('Scenario: Interviewers cannot act in bulk (AIV-P1-036)', () => {
  it('a member the server gives no bulk action sees no checkboxes and no bar, even with a selection in the URL', () => {
    replaceState(null, '', '/?selected=a1,a2');
    showRanking(nine);
    expect(within(table()).queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull();
  });
});

// AIV-P1-114: a recruiter chooses who to interview, after a preview. The server action is faked: these tests check what
// is shown and sent; the stage, interview and audit writes are in tests/integration/src/choose-for-interview.test.ts.
const choosable = (rows = nine) => showRanking(rows, false, ['chooseForInterview']);
const preview = () => screen.getByRole('region', { name: /^Preview: / });

describe('Scenario: Preview, then confirm (AIV-P1-114)', () => {
  // SAFETY: mutation check: dropped `|| !view.reasonValid` from confirmDisabled -> this test failed (sent with no reason)
  it('shows each person with their scores and gaps, round, interviewer and reason; only Confirm sends, with the reason', async () => {
    fake.choose.mockResolvedValue({ ok: true, chosen: 2 });
    choosable();
    await pick('Sara Al Qahtani');
    await pick('Arjun Menon');
    // Compare is not offered: its flag is off.
    expect(within(bar()).queryByRole('button', { name: /compare/i })).toBeNull();
    await userEvent.click(within(bar()).getByRole('button', { name: 'Choose for interview' }));
    expect(within(preview()).getByRole('heading').textContent).toBe('Preview: 2 people chosen for interview');
    const text = preview().textContent;
    expect(
      within(preview()).getByRole('img', { name: '68 backed by evidence · up to 84 if claims hold' }),
    ).toBeTruthy();
    expect(text).toContain('To investigate: Product judgement');
    expect(text).toContain('To investigate: Retrieval and evaluation');
    expect(text).toContain('Round 1, structured screen');
    expect(text).toContain('Interviewer: You');
    expect(text).toContain('Nobody is contacted');
    expect(text).toContain('Nothing changes until you confirm.');
    const reason = within(preview()).getByRole<HTMLTextAreaElement>('textbox', { name: 'Reason' });
    expect(reason.value).toBe('First shortlist');
    // Focus moves into the preview, so the keyboard path continues there.
    expect(document.activeElement).toBe(reason);
    expect(fake.choose).not.toHaveBeenCalled();

    await userEvent.clear(reason);
    expect(preview().textContent).toContain('Give a reason for this choice');
    const confirm = within(preview()).getByRole<HTMLButtonElement>('button', { name: 'Choose 2 for interview' });
    expect(confirm.disabled).toBe(true);
    await userEvent.click(confirm);
    expect(fake.choose).not.toHaveBeenCalled();

    await userEvent.type(reason, 'First shortlist');
    await userEvent.click(confirm);
    expect(fake.choose).toHaveBeenCalledExactlyOnceWith({
      jobId: JOB,
      applicationIds: ['a1', 'a2'],
      reason: 'First shortlist',
    });
    expect(fake.refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole('region', { name: /^Preview: / })).toBeNull();
    expect(screen.getByText(/2 people chosen for interview\. They are on the Interviews page/)).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get('selected')).toBeNull();
  });
});

describe('Scenario: Someone already chosen is not chosen twice (AIV-P1-114)', () => {
  it('marks them "Already chosen for interview", counts only the others, and their row shows the next action', async () => {
    const rows = nine.map((row) => (row.name === 'Sara Al Qahtani' ? { ...row, stage: 'interview' as const } : row));
    choosable(rows);
    const sara = bodyRows().find((row) => row.textContent.includes('Sara Al Qahtani'));
    expect(sara?.textContent).toContain('Chosen for interview');
    await pick('Sara Al Qahtani');
    await pick('Arjun Menon');
    await userEvent.click(within(bar()).getByRole('button', { name: 'Choose for interview' }));
    expect(within(preview()).getByRole('heading').textContent).toBe('Preview: 1 person chosen for interview');
    expect(preview().textContent).toContain('Sara Al QahtaniAlready chosen for interview');
    expect(within(preview()).getByRole('button', { name: 'Choose 1 for interview' })).toBeTruthy();
  });
});

describe('Scenario: Cancel changes nothing (AIV-P1-114)', () => {
  it('closes the preview and sends nothing', async () => {
    choosable();
    await pick('Daniel Novak');
    await userEvent.click(within(bar()).getByRole('button', { name: 'Choose for interview' }));
    expect(preview().textContent).toContain('No evidence gap to investigate');
    await userEvent.click(within(preview()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('region', { name: /^Preview: / })).toBeNull();
    expect(fake.choose).not.toHaveBeenCalled();
  });
});

describe('Scenario: An application from another job is refused (AIV-P1-114)', () => {
  it('says so, changes nothing and keeps the preview open', async () => {
    fake.choose.mockResolvedValue({ ok: false, error: 'notOnJob' });
    choosable();
    await pick('Sara Al Qahtani');
    await userEvent.click(within(bar()).getByRole('button', { name: 'Choose for interview' }));
    await userEvent.click(within(preview()).getByRole('button', { name: 'Choose 1 for interview' }));
    expect(within(preview()).getByRole('alert').textContent).toContain(
      'This candidate has not applied to this job. Nothing was changed.',
    );
    expect(fake.refresh).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startingDraft, type ScorecardCompetency, type ScorecardData } from '@/features/scorecard/domain/scorecard.ts';
import { ScorecardClient } from './ScorecardClient.tsx';

// AIV-P2-004: the scorecard form with its controller, the server action and the router faked. Daniel Novak's Round 1
// on Senior AI Engineer, as the Interview artboard draws it (synthetic cast, personas.md).
const fake = vi.hoisted(() => ({ save: vi.fn(), push: vi.fn() }));
vi.mock('@/features/scorecard/services/saveDraft.ts', () => ({ saveScorecardDraft: fake.save }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: fake.push }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => fake.save.mockResolvedValue(true));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const RETRIEVAL = '0190d4a2-0000-7000-9000-000000000040';
const COST = '0190d4a2-0000-7000-9000-000000000041';
const NOTE = 'Walked through the 200-question set he built';
const BLOCKED = 'Rate this competency, or mark its questions Not asked or Not answered, before submitting';
const question = (text: string) => ({ text, strongAnswer: 'Names the set.', weakAnswer: 'No detail.', citations: [] });

const competencies: ScorecardCompetency[] = [
  {
    competencyId: RETRIEVAL,
    name: 'Retrieval and evaluation',
    weightPercent: 20,
    evidence: {
      competencyId: RETRIEVAL,
      name: 'Retrieval and evaluation',
      weightPercent: 20,
      lead: { strength: 'supporting', provenance: 'claim' },
      items: [{ id: 'e-cv', excerpt: 'raised answer accuracy from 71% to 88%', highlighted: false, own: null }],
      sources: [{ key: 's-cv', kind: 'text', text: 'CV, page 1' }],
      claimOnly: true,
      limits: [],
    },
    questions: [
      question('How was the 71% measured, on which questions, and who built that set?'),
      question('What did you change between 71% and 88%, and what did you try that did not work?'),
    ],
  },
  {
    competencyId: COST,
    name: 'Cost and reliability',
    weightPercent: 15,
    evidence: {
      competencyId: COST,
      name: 'Cost and reliability',
      weightPercent: 15,
      lead: { strength: 'medium', provenance: 'submitted' },
      items: [{ id: 'e-doc', excerpt: 'rolled back the index change', highlighted: true, own: null }],
      sources: [{ key: 's-doc', kind: 'text', text: 'Incident review, March (PDF)' }],
      claimOnly: false,
      limits: ['It shows the fix, but not his part in the on-call response.'],
    },
    questions: [
      question('In the March incident, what did you do in the first thirty minutes?'),
      question('What would you watch to catch it earlier next time?'),
    ],
  },
];

const data = (over: Partial<ScorecardData> = {}): ScorecardData => ({
  interviewId: '0190d4a2-0000-7000-9000-000000000060',
  candidate: 'Daniel Novak',
  job: 'Senior AI Engineer',
  round: 'structured_screen',
  scheduledAt: '2026-11-18T10:00:00.000Z',
  today: true,
  interviewer: null,
  profileHref: '/app/candidates/p-daniel?job=j-ai',
  assessed: { at: '2026-11-12T08:00:00.000Z', backedScore: 55 },
  competencies,
  canEdit: true,
  draft: startingDraft(competencies, null),
  ...over,
});

const show = (over: Partial<ScorecardData> = {}) =>
  render(
    <IntlProvider {...intl}>
      <ScorecardClient data={data(over)} />
    </IntlProvider>,
  );

const card = (name: string) => screen.getByRole('region', { name: new RegExp(`^${name}`) });
const rating = (name: string) => within(card(name)).getByRole('radiogroup', { name: `Your assessment: ${name}` });

describe('Scenario: Scorecard shows what to test', () => {
  it('draws the header, the rounds and each competency with its evidence, source, questions, rating and note', () => {
    show();
    expect(screen.getByRole('heading', { level: 1, name: 'Round 1 scorecard: Daniel Novak' })).toBeTruthy();
    expect(screen.getByText('Senior AI Engineer · structured screen · Today, 14:00 · interviewer: you')).toBeTruthy();
    expect(
      within(screen.getByRole('list', { name: 'Interview rounds' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Evidence assessed12 Nov · backed score 55Observed',
      'Round 1, structured screenCurrent round',
      'Round 2, evidence defenceIf shortlisted',
      'Round 3, panelIf shortlisted',
    ]);

    const retrieval = card('Retrieval and evaluation');
    expect(within(retrieval).getByRole('heading', { level: 2 }).textContent).toBe(
      'Retrieval and evaluation · weight 20%',
    );
    expect(within(retrieval).getByText('Supporting')).toBeTruthy();
    expect(within(retrieval).getByText('Claim awaiting validation')).toBeTruthy();
    // SAFETY: a claim's words are shown plain, never highlighted (AGENTS.md 1.6).
    expect(within(retrieval).getByText('raised answer accuracy from 71% to 88%').closest('mark')).toBeNull();
    expect(within(retrieval).getByText('Claim only. Counts as zero in the backed score.')).toBeTruthy();

    const cost = card('Cost and reliability');
    expect(within(cost).getByRole('heading', { level: 2 }).textContent).toBe('Cost and reliability · weight 15%');
    expect(within(cost).getByText('Medium')).toBeTruthy();
    expect(within(cost).getByText('Candidate-submitted')).toBeTruthy();
    expect(within(cost).getByText('Incident review, March (PDF)')).toBeTruthy();
    expect(within(cost).getByText('rolled back the index change').closest('mark')).not.toBeNull();

    for (const name of ['Retrieval and evaluation', 'Cost and reliability']) {
      expect(
        within(rating(name))
          .getAllByRole('radio')
          .map((r) => r.parentElement?.textContent),
      ).toEqual(['Not shown', 'Partly shown', 'Clearly shown', 'Strongly shown']);
      expect(within(card(name)).getByLabelText('What you saw or heard')).toBeTruthy();
      for (const number of [1, 2]) {
        const marks = within(card(name)).getByRole('group', { name: `Question ${number}` });
        expect(
          within(marks)
            .getAllByRole('button')
            .map((b) => [b.textContent, b.getAttribute('aria-pressed')]),
        ).toEqual([
          ['Not asked', 'false'],
          ['Not answered', 'false'],
        ]);
      }
    }
  });
});

describe('Scenario: No AI or overall judgement of the person', () => {
  it('shows no overall score, interview summary, communication, English, confidence, attitude or soft-skill score', () => {
    const { container } = show();
    expect(container.textContent).not.toMatch(/overall|summary|communication|english|confidence|attitude|soft.skill/i);
    // The only radio groups are one rating per competency and the recommendation.
    expect(screen.getAllByRole('radiogroup').map((g) => g.getAttribute('aria-label') ?? g.textContent)).toHaveLength(3);
  });
});

describe('Scenario: Rate and note', () => {
  it('the keyboard rates, the note is typed, and "Save and close" saves the draft and opens Interviews', async () => {
    const user = userEvent.setup();
    show();
    const radios = within(rating('Retrieval and evaluation')).getAllByRole('radio');
    radios[0]?.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect((radios[2] as HTMLInputElement).checked).toBe(true);
    await user.type(within(card('Retrieval and evaluation')).getByLabelText('What you saw or heard'), NOTE);
    await user.click(screen.getByRole('button', { name: 'Save and close' }));

    const sent = fake.save.mock.calls.at(-1)?.[0];
    expect(sent.interviewId).toBe(data().interviewId);
    expect(sent.draft.competencies[0]).toMatchObject({ rating: 'clearly_shown', note: NOTE });
    expect(sent.draft.competencies[1]).toMatchObject({ rating: null, note: '' });
    expect(fake.push).toHaveBeenCalledWith('/app/interviews');
    // The assessment line is as it was: saving a draft changes no score.
    expect(screen.getByText('12 Nov · backed score 55')).toBeTruthy();
  });

  it('a draft that could not be saved says so and stays on the page', async () => {
    fake.save.mockResolvedValue(false);
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: 'Save and close' }));
    expect(screen.getByText('We could not save your draft. Try again.')).toBeTruthy();
    expect(fake.push).not.toHaveBeenCalled();
  });

  it('saves by itself a moment after a change', async () => {
    vi.useFakeTimers();
    show();
    act(() => within(rating('Cost and reliability')).getAllByRole('radio')[1]?.click());
    expect(fake.save).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(fake.save).toHaveBeenCalledTimes(1);
    expect(fake.save.mock.calls[0]?.[0].draft.competencies[1].rating).toBe('partly_shown');
    expect(screen.getByText(/^Draft saved\./)).toBeTruthy();
  });

  it('leaving the page before that moment still saves what was changed', async () => {
    const user = userEvent.setup();
    const { unmount } = show();
    await user.click(within(rating('Cost and reliability')).getAllByRole('radio')[3] as HTMLElement);
    expect(fake.save).not.toHaveBeenCalled();
    unmount();
    expect(fake.save.mock.calls[0]?.[0].draft.competencies[1].rating).toBe('strongly_shown');
  });
});

describe('Scenario Outline: A competency that was not tested stays a gap', () => {
  it.each(['Not asked', 'Not answered'])('every question marked "%s" disables the rating', async (mark) => {
    const user = userEvent.setup();
    show();
    const cost = card('Cost and reliability');
    await user.click(within(rating('Cost and reliability')).getAllByRole('radio')[0] as HTMLElement);
    const [first, second] = within(cost).getAllByRole('button', { name: mark });
    await user.click(first as HTMLElement);
    // One question still open: the rating is still there to give.
    expect((rating('Cost and reliability') as HTMLFieldSetElement).disabled).toBe(false);
    expect(within(cost).queryByText('Not assessed in this round · stays a gap')).toBeNull();
    await user.click(second as HTMLElement);
    expect((rating('Cost and reliability') as HTMLFieldSetElement).disabled).toBe(true);
    expect(within(cost).getByText('Not assessed in this round · stays a gap')).toBeTruthy();
    // The "Not shown" given before is no longer shown as its rating.
    expect(
      within(rating('Cost and reliability'))
        .getAllByRole('radio')
        .some((r) => (r as HTMLInputElement).checked),
    ).toBe(false);
    // The other competency is untouched.
    expect((rating('Retrieval and evaluation') as HTMLFieldSetElement).disabled).toBe(false);
  });

  it('the two marks exclude each other, and the same mark again clears it', async () => {
    const user = userEvent.setup();
    show();
    const marks = within(card('Cost and reliability')).getByRole('group', { name: 'Question 1' });
    const pressed = () =>
      within(marks)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-pressed'));
    await user.click(within(marks).getByRole('button', { name: 'Not asked' }));
    expect(pressed()).toEqual(['true', 'false']);
    await user.click(within(marks).getByRole('button', { name: 'Not answered' }));
    expect(pressed()).toEqual(['false', 'true']);
    await user.click(within(marks).getByRole('button', { name: 'Not answered' }));
    expect(pressed()).toEqual(['false', 'false']);
  });

  it('a competency with no suggested question can still be marked as not tested', async () => {
    const [retrieval, cost] = competencies;
    const bare = [retrieval, { ...cost, questions: [] }] as ScorecardCompetency[];
    const user = userEvent.setup();
    show({ competencies: bare, draft: startingDraft(bare, null) });
    const card2 = card('Cost and reliability');
    expect(within(card2).getByText(/^No questions are suggested for this competency yet\./)).toBeTruthy();
    expect(
      within(card2).getByRole('link', { name: 'Suggest questions on the evidence profile' }).getAttribute('href'),
    ).toBe('/app/candidates/p-daniel?job=j-ai');
    const own = within(card2).getByRole('group', { name: 'Your own questions on this competency' });
    await user.click(within(own).getByRole('button', { name: 'Not asked' }));
    expect(within(card2).getByText('Not assessed in this round · stays a gap')).toBeTruthy();
  });
});

describe('Scenario: Submit needs every competency rated or marked not tested', () => {
  it('names the competency that is neither rated nor marked, then accepts it once it is', async () => {
    const user = userEvent.setup();
    show();
    await user.click(within(rating('Retrieval and evaluation')).getAllByRole('radio')[2] as HTMLElement);
    expect(screen.queryByText(BLOCKED)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Submit scorecard' }));
    expect(within(card('Cost and reliability')).getByRole('alert').textContent).toBe(BLOCKED);
    expect(within(card('Retrieval and evaluation')).queryByRole('alert')).toBeNull();
    expect(rating('Cost and reliability').getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByText(/^Your scorecard is complete/)).toBeNull();

    for (const button of within(card('Cost and reliability')).getAllByRole('button', { name: 'Not asked' }))
      await user.click(button);
    expect(screen.queryByText(BLOCKED)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Submit scorecard' }));
    // It says plainly that nothing was submitted or changed (submitting is AIV-P2-006).
    expect(
      screen.getByText(
        'Your scorecard is complete and saved as a draft. It has not been submitted: the assessment, the stage and the ranking are unchanged.',
      ),
    ).toBeTruthy();
    expect(fake.push).not.toHaveBeenCalled();
  });
});

describe('Scenario: Recommendation is not a decision', () => {
  it('a recommendation is one field of the draft, beside the line that says who decides', async () => {
    const user = userEvent.setup();
    show();
    const group = screen.getByRole('radiogroup', { name: 'Next-stage recommendation' });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.parentElement?.textContent),
    ).toEqual(['Recommend for the Round 2 shortlist', 'Ask for more evidence first', 'Do not recommend for Round 2']);
    await user.click(within(group).getByRole('radio', { name: 'Recommend for the Round 2 shortlist' }));
    expect(
      screen.getByText('A recommendation, not a decision. The hiring owner decides in the decision pack.'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save and close' }));
    // The draft is all that is sent: no stage, no decision.
    expect(Object.keys(fake.save.mock.calls.at(-1)?.[0])).toEqual(['interviewId', 'draft']);
    expect(fake.save.mock.calls.at(-1)?.[0].draft.recommendation).toBe('shortlist');
  });
});

describe('a member who may not change the scorecard', () => {
  it('reads it with every control disabled and no way to save', () => {
    show({ canEdit: false });
    expect(screen.getByText(/^You can read this scorecard but not change it\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save and close' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit scorecard' })).toBeNull();
    for (const group of screen.getAllByRole('radiogroup')) expect((group as HTMLFieldSetElement).disabled).toBe(true);
    for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
    for (const note of screen.getAllByLabelText('What you saw or heard'))
      expect((note as HTMLTextAreaElement).disabled).toBe(true);
  });
});

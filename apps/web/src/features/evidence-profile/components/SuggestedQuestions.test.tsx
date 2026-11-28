// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { QuestionsView } from '../domain/questions.ts';
import { SuggestedQuestions, type SuggestedQuestionsProps } from './SuggestedQuestions.tsx';

// AIV-P1-113: "Needs live verification" in every state. Synthetic cast only (Daniel Novak).
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const QUESTION = 'How was the 71% measured, on which questions, and who built that set?';
const suggested = (stale = false): QuestionsView => ({
  status: 'suggested',
  stale,
  gaps: [
    {
      competencyId: 'c-retrieval',
      name: 'Retrieval and evaluation',
      questions: [
        {
          text: QUESTION,
          strongAnswer: 'Names the set and who built it.',
          weakAnswer: 'Repeats the figure.',
          citations: [
            { key: 'i-cv:0', quote: 'raised answer accuracy from 71% to 88%', label: 'CV, page 1', highlighted: false },
            { key: 'i-doc:1', quote: 'held-out questions', label: 'Eval write-up', highlighted: true },
          ],
        },
        {
          text: 'What did you change yourself?',
          strongAnswer: 'Names a change.',
          weakAnswer: 'Credits the team.',
          citations: [{ key: 'rubric:0', quote: 'Eval sets', label: null, highlighted: false }],
        },
      ],
    },
  ],
});
const show = (view: QuestionsView, more: Partial<SuggestedQuestionsProps> = {}) => {
  const onSuggest = vi.fn();
  render(
    <IntlProvider {...intl}>
      <SuggestedQuestions view={view} problem={null} pending={false} onSuggest={onSuggest} {...more} />
    </IntlProvider>,
  );
  return onSuggest;
};

describe('SuggestedQuestions', () => {
  it('Scenario: A candidate with no gaps: says so, with no button to suggest questions', () => {
    show({ status: 'no_gaps' });
    expect(screen.getByRole('heading', { level: 2, name: 'Interview questions' })).toBeDefined();
    expect(screen.getByText("No open gaps. No competency is below the job's need or rests on a claim.")).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('gaps with no questions yet: one button, reached and pressed by keyboard', async () => {
    const onSuggest = show({ status: 'not_suggested' });
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Suggest interview questions' }));
    await userEvent.keyboard('{Enter}');
    expect(onSuggest).toHaveBeenCalledOnce();
  });

  it('while asking, the button says so and cannot be pressed again, and the wait is announced', () => {
    show({ status: 'not_suggested' }, { pending: true });
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Suggesting interview questions…' });
    expect(button.disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Suggesting interview questions…');
  });

  it('Scenario: Questions for each gap, each cited: the questions under their gap, each with its source and both notes', () => {
    show(suggested());
    const gap = screen.getByRole('region', { name: 'Retrieval and evaluation' });
    const [first, second] = within(gap).getAllByRole('listitem');
    if (!first || !second) throw new Error('two questions expected');
    expect(first.textContent).toContain(QUESTION);
    expect(first.textContent).toContain('Source: CV, page 1');
    expect(first.textContent).toContain('A strong answer shows: Names the set and who built it.');
    expect(first.textContent).toContain('A weak answer shows: Repeats the figure.');
    // SAFETY: only inspected work is highlighted; the CV claim's words are quoted plain (AGENTS.md 1.6).
    expect([...first.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual([
      'cited evidence held-out questions',
    ]);
    expect(first.querySelector('q')?.textContent).toBe('raised answer accuracy from 71% to 88%');
    expect(second.textContent).toContain("Source: the job's rubric");
    // Stored for the snapshot: nothing more to ask for.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('Scenario: kept for the snapshot: a changed snapshot says so and offers "Suggest again" beside the old questions', async () => {
    const onSuggest = show(suggested(true));
    expect(screen.getByText('Evidence changed since these questions were suggested.')).toBeDefined();
    expect(screen.getByText(QUESTION)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Suggest again' }));
    expect(onSuggest).toHaveBeenCalledOnce();
  });

  it.each([
    ['waiting', "Waiting for tomorrow's AI allowance"],
    ['failed', 'Questions could not be suggested. You can write your own.'],
  ] as const)('Scenario: %s: says why and keeps the button', (problem, text) => {
    show({ status: 'not_suggested' }, { problem });
    expect(screen.getByRole('alert').textContent).toBe(text);
    expect(screen.getByRole('button', { name: 'Suggest interview questions' })).toBeDefined();
  });
});

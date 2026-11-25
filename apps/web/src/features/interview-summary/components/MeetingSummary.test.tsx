// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { errorKey, includedByDefault, type SummaryPanel, type SummaryProposal } from '../domain/summary.ts';
import { MeetingSummary, type MeetingSummaryView } from './MeetingSummary.tsx';

// AIV-P1-115: the "Meeting summary" panel in every state. Synthetic cast only (Daniel Novak).
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const QUOTE = 'walked through the 200-question evaluation set he built';
const RETRIEVAL: SummaryProposal = {
  competencyId: 'c-retrieval',
  name: 'Retrieval and evaluation',
  finding: 'clearly_shown',
  excerpt: QUOTE,
  reason: 'Describes the evaluation set he built.',
  change: { from: 'supporting', to: 'medium' },
  alreadyChanged: false,
};
const COST: SummaryProposal = {
  competencyId: 'c-cost',
  name: 'Cost and reliability',
  finding: 'not_mentioned',
  excerpt: null,
  reason: null,
  change: null,
  alreadyChanged: false,
};
const panelOf = (
  status: NonNullable<SummaryPanel['summary']>['status'] | null,
  proposals: SummaryProposal[] = [RETRIEVAL, COST],
  more: Partial<NonNullable<SummaryPanel['summary']>> = {},
): SummaryPanel => ({
  interviewId: 'i-1',
  summary: status && {
    summaryId: 's-1',
    status,
    unusual: false,
    proposals,
    preview: { previewId: 'p-1', competencyIds: ['c-retrieval'], backedScore: { from: 55, to: 61 } },
    previewUnavailable: false,
    ...more,
  },
});

function show(panel: SummaryPanel, more: Partial<MeetingSummaryView> = {}) {
  const proposals = panel.summary?.proposals ?? [];
  const view: MeetingSummaryView = {
    panel,
    text: '',
    error: null,
    busy: false,
    included: includedByDefault(proposals),
    reasons: Object.fromEntries(proposals.map((p) => [p.competencyId, p.reason ?? ''])),
    preview: panel.summary?.preview ?? null,
    reasonMissing: false,
    onText: vi.fn(),
    onAnalyse: vi.fn(),
    onInclude: vi.fn(),
    onReason: vi.fn(),
    onApply: vi.fn(async () => undefined),
    onDecline: vi.fn(),
    onRetryPreview: vi.fn(),
    ...more,
  };
  render(
    <IntlProvider {...intl}>
      <MeetingSummary view={view} />
    </IntlProvider>,
  );
  return view;
}

describe('the summary box', () => {
  it('has the count, the note on what is removed, and "Analyse summary"', async () => {
    const view = show(panelOf(null), { text: 'Daniel walked through the set.' });
    expect(screen.getByRole('heading', { level: 2, name: 'Meeting summary' })).toBeTruthy();
    expect(screen.getByText('30 of 12,000 characters')).toBeTruthy();
    expect(screen.getByText('Names, emails and phone numbers are removed before Credalent reads it.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Analyse summary' }));
    expect(view.onAnalyse).toHaveBeenCalledOnce();
    expect(screen.queryByText('Nothing changes until you confirm.')).toBeNull();
  });

  it.each([
    ['summary_empty', 'Paste the meeting summary first.'],
    ['summary_too_long', 'Shorten the summary to 12,000 characters or fewer.'],
  ] as const)('says why nothing was analysed: %s', (error, message) => {
    show(panelOf(null), { error });
    expect(screen.getByRole('alert').textContent).toBe(message);
  });

  it.each([
    ['analysing', 'Analysing the summary…'],
    ['waiting', "Waiting for tomorrow's AI allowance. Your summary is saved."],
  ] as const)('while %s it says so and offers no second box', (status, message) => {
    show(panelOf(status, []));
    expect(screen.getAllByRole('status').map((region) => region.textContent)).toContain(message);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('a summary that could not be analysed says so and can be pasted again', () => {
    show(panelOf('failed', []));
    expect(screen.getByText('The summary could not be analysed. You can rate on the scorecard instead.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Summary of the interview' })).toBeTruthy();
  });
});

describe('Scenario: Analysing a summary proposes a change and applies nothing', () => {
  it('shows the change with its excerpt highlighted, the backed score with both basis markers, and one primary button', () => {
    show(panelOf('proposed'));
    const card = screen.getByRole('region', { name: 'Effect on the assessment' });
    expect(within(card).getByText('Retrieval and evaluation: Supporting to Medium')).toBeTruthy();
    expect(card.querySelector('mark')?.textContent).toBe(`cited evidence ${QUOTE}`);
    expect(within(card).getByText('Backed score 55 to 61')).toBeTruthy();
    expect(within(card).getByText('Before: Observed')).toBeTruthy();
    expect(within(card).getByText('After: Projection')).toBeTruthy();
    expect(within(card).getByText('Nothing changes until you confirm.')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Apply 1 change' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Decline' })).toBeTruthy();
    expect((within(card).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect((within(card).getByLabelText('Reason for Retrieval and evaluation') as HTMLTextAreaElement).value).toBe(
      'Describes the evaluation set he built.',
    );
  });

  it('Scenario: what the summary does not cover stays a gap, with no change and nothing to tick', () => {
    show(panelOf('proposed'));
    expect(screen.getByText('Cost and reliability: not covered in the summary · stays a gap')).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('only "Apply" applies and only "Decline" declines; Escape in a reason field declines nothing', async () => {
    const view = show(panelOf('proposed'));
    const reason = screen.getByLabelText('Reason for Retrieval and evaluation');
    await userEvent.type(reason, '{Escape}');
    expect(view.onDecline).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Apply 1 change' }));
    expect(view.onApply).toHaveBeenCalledOnce();
  });

  it('"Already changed by the scorecard" is said, and that change starts unticked with nothing to apply', () => {
    show(panelOf('proposed', [{ ...RETRIEVAL, alreadyChanged: true }], { preview: null }));
    expect(screen.getByText('Already changed by the scorecard')).toBeTruthy();
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('button', { name: 'Apply 0 changes' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a change with no reason cannot be applied', () => {
    show(panelOf('proposed'), { reasonMissing: true });
    expect((screen.getByRole('button', { name: 'Apply 1 change' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Give a reason for each change you include.')).toBeTruthy();
  });

  it('notes unusual content, and says when the assessment cannot be previewed', () => {
    show(panelOf('proposed', [RETRIEVAL], { unusual: true, preview: null, previewUnavailable: true }));
    expect(screen.getByText('Unusual content in this summary')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('after a decision', () => {
  it('applied: says so and offers the box again', () => {
    show(panelOf('applied', []));
    expect(
      screen.getByText('The changes you confirmed are applied and logged. The assessment and the ranking are updated.'),
    ).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Summary of the interview' })).toBeTruthy();
  });

  it('declined: nothing changed', () => {
    show(panelOf('declined', []));
    expect(screen.getByText('Declined. Nothing changed, and the summary stays on this interview.')).toBeTruthy();
  });
});

describe('the panel domain', () => {
  it('ticks by default each change the scorecard has not already made', () => {
    expect(includedByDefault([RETRIEVAL, COST, { ...RETRIEVAL, competencyId: 'c-x', alreadyChanged: true }])).toEqual([
      'c-retrieval',
    ]);
  });
  it('gives a refusal it has no words for the general message', () => {
    expect([errorKey('summary_pending'), errorKey('proposal_not_found')]).toEqual(['summary_pending', 'failed']);
  });
});

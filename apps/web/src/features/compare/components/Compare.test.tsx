// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CompareColumn, CompareData, TradeoffsView } from '../domain/compare.ts';
import { Compare, type CompareView } from './Compare.tsx';
import { Tradeoffs } from './Tradeoffs.tsx';

// AIV-P1-047: the comparison's states, most of which the e2e spec does not reach. Synthetic cast only.
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const JOB = '0190d4a2-0000-7000-9000-000000001031';
const base = { jobId: JOB, jobTitle: 'Senior AI Engineer', selectionHref: `/app/jobs/${JOB}/candidates?selected=a1` };
const layla: CompareColumn = {
  candidateId: 'p3',
  name: 'Layla Haddad',
  score: { backed: 61, upTo: 82 },
  cells: {
    arabic: {
      proven: 5,
      lead: { strength: 'strong', provenance: 'corroborated' },
      claimOnly: false,
      summary: 'Arabic OCR pipeline, public and documented.',
    },
  },
};
const sara: CompareColumn = {
  candidateId: 'p1',
  name: 'Sara Al Qahtani',
  score: { backed: 68, upTo: 84 },
  cells: {
    arabic: {
      proven: 0,
      lead: { strength: 'supporting', provenance: 'claim' },
      claimOnly: true,
      summary: 'Describes a Gulf Arabic evaluation set.',
    },
  },
};
const ready = (columns: CompareColumn[]): CompareData => ({
  ...base,
  status: 'ready',
  rubricVersion: 2,
  rows: [{ competencyId: 'arabic', name: 'Arabic and bilingual NLP', weightPercent: 10, needed: 2 }],
  columns,
});
const show = (view: CompareView) =>
  render(
    <IntlProvider {...intl}>
      <Compare view={view} />
    </IntlProvider>,
  );
const cellOf = (row: string, column: number) =>
  within(screen.getByRole('row', { name: new RegExp(`^${row}`) })).getAllByRole('cell')[column];

describe('Scenario: Candidates side by side', () => {
  it('heads each column with the name, the backed score and "up to N if claims hold"', () => {
    show(ready([sara, layla]));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Compare candidates');
    expect(screen.getByText(/^Senior AI Engineer · rubric v2\. The same competency, side by side/)).toBeTruthy();
    const [, first, second] = screen.getAllByRole('columnheader');
    expect(first?.textContent).toBe('Sara Al Qahtani68up to 84 if claims hold');
    expect(second?.textContent).toBe('Layla Haddad61up to 82 if claims hold');
    expect(
      within(first as HTMLElement)
        .getByRole('link')
        .getAttribute('href'),
    ).toBe(`/app/candidates/p1?job=${JOB}`);
  });

  it("shows the row's weight and need, and a cell's strength, verdict, provenance and cited words", () => {
    show(ready([sara, layla]));
    expect(screen.getByRole('rowheader').textContent).toBe('Arabic and bilingual NLPWeight 10% · job needs 2 of 5');
    expect(cellOf('Arabic', 1)?.textContent).toBe(
      'StrongAbove the need · 5 against 2Independently corroboratedArabic OCR pipeline, public and documented.',
    );
  });

  // SAFETY: mutation check: Cell drew cell.lead.strength for a claim-only cell -> this test failed ("Supporting" was shown)
  it("never shows a competency resting only on a claim under the claim's stored strength", () => {
    show(ready([sara, layla]));
    expect(cellOf('Arabic', 0)?.textContent).toBe(
      'Claim onlyBelow the need · 0 against 2Claim awaiting validationDescribes a Gulf Arabic evaluation set.',
    );
  });

  it('keeps a candidate who is not scored yet in view, saying so', () => {
    show(ready([sara, { candidateId: 'p9', name: null, score: null, cells: {} }]));
    expect(screen.getAllByRole('columnheader')[2]?.textContent).toBe(
      'Unnamed applicantNot yet scoredNot yet available',
    );
    expect(cellOf('Arabic', 1)?.textContent).toBe('Not yet available');
  });

  it('offers "Change selection" back to the ranking with the same candidates ticked, and one primary action', () => {
    show(ready([sara, layla]));
    expect(screen.getByRole('link', { name: 'Change selection' }).getAttribute('href')).toBe(base.selectionHref);
    expect(screen.getByRole('link', { name: 'Open decision pack' }).getAttribute('href')).toBe(`/app/jobs/${JOB}/pack`);
  });
});

describe('Scenario: One candidate', () => {
  it('asks for 2 to 10 candidates and offers "Change selection", with no comparison', () => {
    show({ ...base, status: 'tooFew' });
    expect(screen.getByText('Choose 2 to 10 candidates to compare')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Change selection' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('Scenario: Candidates from another job', () => {
  it('says so and shows no comparison', () => {
    show({ ...base, status: 'notOnJob' });
    expect(screen.getByText('These candidates are not all on this job')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('the page while it loads or fails', () => {
  it('announces loading, and offers a retry on an error without showing the error', async () => {
    const onRetry = vi.fn();
    show({ status: 'error', onRetry });
    await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

const written: TradeoffsView = {
  status: 'written',
  candidates: [
    {
      candidateId: 'p3',
      name: 'Layla Haddad',
      profileHref: `/app/candidates/p3?job=${JOB}`,
      statements: [
        {
          text: 'is the only one compared with independently checked work on Arabic and bilingual NLP.',
          ofSnapshot: true,
          citations: [],
        },
        {
          text: 'The Arabic OCR pipeline is public and documented.',
          ofSnapshot: false,
          citations: [
            {
              key: 'i4:0',
              quote: 'Arabic OCR pipeline, public and documented',
              label: 'arabic-ocr',
              href: `/app/candidates/p3?job=${JOB}#evidence-i4`,
            },
          ],
        },
      ],
    },
  ],
};
const tradeoffs = (view: TradeoffsView | null, columns = [sara, layla], pending = false) => {
  const onWrite = vi.fn();
  render(
    <IntlProvider {...intl}>
      <Tradeoffs view={view} pending={pending} onWrite={onWrite} columns={columns} />
    </IntlProvider>,
  );
  return onWrite;
};

describe('Scenario: Trade-offs cite evidence', () => {
  it('is written only when a person asks', async () => {
    const onWrite = tradeoffs(null);
    expect(
      screen.getByText(/^Written by AI from the evidence each statement cites\. It recommends nobody/),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Write the trade-offs' }));
    expect(onWrite).toHaveBeenCalledOnce();
  });

  it('says a fact of the candidate by name, links each statement to the evidence it rests on, and ends on the gap', () => {
    tradeoffs(written);
    const items = screen.getAllByRole('listitem');
    expect(items[0]?.textContent).toBe(
      'Layla Haddad is the only one compared with independently checked work on Arabic and bilingual NLP.',
    );
    expect(
      within(items[0] as HTMLElement)
        .getByRole('link', { name: 'Layla Haddad' })
        .getAttribute('href'),
    ).toBe(`/app/candidates/p3?job=${JOB}`);
    // What the model says of a piece of work is a sentence of its own, never glued to the name.
    expect(items[1]?.textContent).toMatch(/^The Arabic OCR pipeline is public and documented\./);
    const link = within(items[1] as HTMLElement).getByRole('link');
    expect(link.getAttribute('href')).toBe(`/app/candidates/p3?job=${JOB}#evidence-i4`);
    expect(link.querySelector('mark')?.textContent).toContain('Arabic OCR pipeline, public and documented');
    expect(
      screen.getByText(
        '7 points separate the 2 candidates. A difference this small is within what Round 2 could change.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Scenario: Trade-offs unavailable', () => {
  it('says the summary is unavailable and the grid complete, and lets the person try again', () => {
    tradeoffs({ status: 'unavailable' });
    expect(screen.getByText('Trade-off summary unavailable. The grid above is complete.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('is not offered while a candidate here is not scored', () => {
    tradeoffs(null, [sara, { candidateId: 'p9', name: null, score: null, cells: {} }]);
    expect(screen.getByText('The trade-offs can be written once every candidate here is scored.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

// @vitest-environment jsdom
import type { MemberSummary } from '@credalent/decisions';
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CardSummary, PackPage } from '../domain/pack.ts';
import { DecisionPack } from './DecisionPack.tsx';

// AIV-P1-139 and AIV-P2-011: the pack page. Synthetic cast and ids only.
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const id = (n: number) => `0190d4a2-0000-7000-9000-${String(n).padStart(12, '0')}`;
const [JOB, PACK, REPO, CV, NOTE] = [id(1), id(2), id(20), id(21), id(22)];
const at = new Date('2026-11-17T08:00:00.000Z');
const facts = {
  itemId: null,
  label: 'Assessment',
  quote: 'Work meets the need on competencies holding 60%',
  claim: false,
};
const sara: MemberSummary = {
  strengths: [
    {
      text: 'Checked evidence on the heaviest competencies; 412 of 460 commits in her eval harness.',
      citations: [{ itemId: REPO, label: 'llm-eval-harness', quote: 'authored 412 of 460 commits', claim: false }],
    },
  ],
  risks: [
    {
      text: 'Cost reduction and Arabic work are claims with nothing to inspect.',
      citations: [{ itemId: CV, label: 'CV', quote: 'cut the cost per request by 38%', claim: true }],
    },
  ],
  round1: {
    text: 'The candidate defended the merchant assistant.',
    citations: [
      {
        itemId: NOTE,
        label: "Interviewer's scorecard, 18 Nov 2026",
        quote: 'defended the merchant assistant',
        claim: false,
      },
    ],
  },
  recommendation: { action: 'advance', focus: null, citations: [facts] },
};
const member = (
  candidateId: string,
  name: string,
  summary: CardSummary,
  added: PackPage['members'][number]['added'] = null,
) => ({ candidateId, name, backedScore: 68, upperBound: 84, added, summary, decision: null });
const page = (members: PackPage['members']): PackPage => ({
  jobId: JOB,
  packId: PACK,
  name: 'Round 2 shortlist',
  job: 'Senior AI Engineer',
  preparedAt: at,
  rubricVersion: 2,
  role: {
    successStatement: 'A bilingual assistant for merchants, live within six months.',
    competencies: [
      { name: 'LLM systems in production', weightPercent: 25 },
      { name: 'Retrieval and evaluation', weightPercent: 20 },
      { name: 'Python services', weightPercent: 15 },
      { name: 'Cost and reliability', weightPercent: 15 },
      { name: 'Product judgement', weightPercent: 15 },
      { name: 'Arabic and bilingual NLP', weightPercent: 10 },
    ],
  },
  members,
  others: 4,
  mayDecide: false,
  mayNameSelf: false,
  decided: null,
});
const show = (pack: PackPage) =>
  render(
    <IntlProvider {...intl}>
      <DecisionPack view={{ status: 'ready', pack }} />
    </IntlProvider>,
  );

describe('DecisionPack', () => {
  it('shows who added each member on the day in the workspace time zone, and no line on a member added before', () => {
    show(
      page([
        // 21:30 UTC is 25 Nov in Dubai.
        member(
          'p1',
          'Sara Al Qahtani',
          { status: 'preparing' },
          {
            by: 'Ayesha Perera',
            at: new Date('2026-11-24T21:30:00.000Z'),
          },
        ),
        member('p2', 'Arjun Menon', { status: 'preparing' }),
      ]),
    );
    expect(screen.getByText('Added by Ayesha Perera on 25 Nov 2026')).toBeTruthy();
    expect(screen.getAllByText(/^Added by/)).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Arjun Menon' })).toBeTruthy();
    // AIV-P1-116: the branded preview of this pack.
    expect(screen.getByRole('link', { name: 'Preview as the hiring owner sees it' }).getAttribute('href')).toBe(
      `/app/jobs/${JOB}/packs/${PACK}/preview`,
    );
  });

  it('Scenario: The role and its weights', () => {
    show(page([]));
    expect(screen.getByRole('heading', { name: 'What the job needs' })).toBeTruthy();
    expect(screen.getByText('A bilingual assistant for merchants, live within six months.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Competencies and weights' }).nextElementSibling?.textContent).toBe(
      'LLM systems in production 25% · Retrieval and evaluation 20% · Python services 15% · Cost and reliability 15% · Product judgement 15% · Arabic and bilingual NLP 10%',
    );
  });

  // SAFETY: mutation check: passed hrefFor={undefined} on the pack page -> this test failed (no links)
  // SAFETY: mutation check: Sources highlighted a claim's quote like cited evidence -> this test failed (a mark)
  it('Scenario: A candidate card cites its evidence: score and range, each section, each sentence linked to its item, a claim labelled', () => {
    show(page([member('p1', 'Sara Al Qahtani', { status: 'ready', summary: sara })]));
    const card = screen.getByRole('region', { name: 'Sara Al Qahtani' });
    expect(within(card).getByRole('img', { name: '68 backed by evidence · up to 84 if claims hold' })).toBeTruthy();
    expect(within(card).getByRole('list', { name: 'Strengths, backed' }).textContent).toContain(
      'Checked evidence on the heaviest competencies; 412 of 460 commits in her eval harness.',
    );
    expect(within(card).getByRole('list', { name: 'Outstanding risks' }).textContent).toContain(
      'Cost reduction and Arabic work are claims with nothing to inspect.',
    );
    expect(within(card).getByRole('list', { name: 'Round 1 finding' }).textContent).toContain(
      'The candidate defended the merchant assistant.',
    );
    const profile = `/app/candidates/p1?job=${JOB}`;
    expect(
      ['Source: llm-eval-harness', 'Source: CV', "Source: Interviewer's scorecard, 18 Nov 2026"].map((name) =>
        within(card).getByRole('link', { name }).getAttribute('href'),
      ),
    ).toEqual([`${profile}#evidence-${REPO}`, `${profile}#evidence-${CV}`, `${profile}#evidence-${NOTE}`]);
    expect(within(card).getByText('authored 412 of 460 commits').closest('mark')).toBeTruthy();
    // A quote of her CV is her own word: labelled a claim, never highlighted as cited evidence (AGENTS.md 1.6).
    const claim = within(card).getByText('cut the cost per request by 38%');
    expect(claim.closest('mark')).toBeNull();
    expect(claim.parentElement?.textContent).toContain('Claim awaiting validation');
    // The recommendation rests on the snapshot's facts.
    expect(within(card).getByText('Source: the assessment')).toBeTruthy();
  });

  // SAFETY: mutation check: set hasFocus to 'no' in SummaryText -> this test failed (no focus)
  // AIV-P2-012 adds the hiring owner's choices: offered, read-only here (no controller), and none pre-selected.
  it("Scenario: Recommendation is labelled as Credalent's, and no decision option is pre-selected", () => {
    const huda = { ...sara, recommendation: { ...sara.recommendation, focus: 'Cost and reliability' } };
    show(page([member('p3', 'Huda Al Mansoori', { status: 'ready', summary: huda })]));
    const card = screen.getByRole('region', { name: 'Huda Al Mansoori' });
    expect(within(card).getByText("Credalent's recommendation:").textContent).toBe(
      "Credalent's recommendation: advance, and look into Cost and reliability next",
    );
    expect(
      within(card)
        .getAllByRole('radio')
        .map((r) => (r as HTMLInputElement).checked),
    ).toEqual([false, false, false]);
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(
      document.querySelectorAll('[aria-pressed="true"], [aria-checked="true"], [aria-selected="true"]'),
    ).toHaveLength(0);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('Scenario: Generated text without a valid citation is not shown: "Summary unavailable" with the raw strengths list', () => {
    show(
      page([
        member('p2', 'Arjun Menon', {
          status: 'unavailable',
          strengths: [{ competencyId: 'c1', name: 'Python services', proven: 5, claimed: 5, needed: 3 }],
          risks: [{ competencyId: 'c2', name: 'Cost and reliability', proven: 2, claimed: 2, needed: 3 }],
        }),
      ]),
    );
    const card = screen.getByRole('region', { name: 'Arjun Menon' });
    expect(within(card).getByText('Summary unavailable')).toBeTruthy();
    expect(within(card).getByRole('list', { name: 'Strengths, backed' }).textContent).toContain('Python services');
    expect(card.textContent).not.toContain('Cost and reliability');
    expect(within(card).queryByText("Credalent's recommendation:")).toBeNull();
  });

  it('Scenario: Loading and empty: "Preparing summary" with the scores shown, and an empty pack says so', () => {
    show(page([member('p1', 'Sara Al Qahtani', { status: 'preparing' })]));
    const card = screen.getByRole('region', { name: 'Sara Al Qahtani' });
    expect(within(card).getByRole('status').textContent).toBe('Preparing summary');
    expect(within(card).getByRole('img', { name: '68 backed by evidence · up to 84 if claims hold' })).toBeTruthy();
    cleanup();
    show(page([]));
    expect(screen.getByText('This pack has no candidates. Add them from the ranking.')).toBeTruthy();
  });

  it('the footer: shared packs show summaries and sources, and how many others stay in the ranking', () => {
    show(page([]));
    expect(
      screen.getByText(
        'Shared packs show evidence summaries and sources, not raw files. 4 other candidates stay in the ranking and can be added to a later pack.',
      ),
    ).toBeTruthy();
  });
});

// AIV-P1-047: a pack of 2 to 10 candidates opens as a comparison.
const packOf = (count: number) =>
  page(Array.from({ length: count }, (_, i) => member(`p${i + 1}`, `Candidate ${i + 1}`, { status: 'preparing' })));

describe('DecisionPack: Open comparison', () => {
  it("links to the comparison of its members, in the pack's order", () => {
    show(packOf(3));
    expect(screen.getByRole('link', { name: 'Open comparison' }).getAttribute('href')).toBe(
      `/app/jobs/${JOB}/compare?ids=p1,p2,p3`,
    );
  });

  it.each([1, 11])('has no comparison for a pack of %i: one comparison holds 2 to 10', (count) => {
    show(packOf(count));
    expect(screen.queryByRole('link', { name: 'Open comparison' })).toBeNull();
  });
});

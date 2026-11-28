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
const page = (members: PackPage['members'], client: string | null = null): PackPage => ({
  jobId: JOB,
  packId: PACK,
  name: 'Round 2 shortlist',
  job: 'Senior AI Engineer',
  client,
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

const scored = (candidateId: string, name: string, backedScore: number, upperBound: number) => ({
  ...member(candidateId, name, { status: 'ready', summary: sara }),
  backedScore,
  upperBound,
});

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
    // The recommendation rests on the snapshot's facts, which open the profile.
    expect(within(card).getByRole('link', { name: 'Source: the assessment' }).getAttribute('href')).toBe(profile);
  });

  // AIV-P1-165 section 13 "Sources link to the evidence".
  it('Scenario: Sources link to the evidence: one cited excerpt per section with numbered sources, and no empty Round 1 finding', () => {
    const second = { itemId: NOTE, label: 'Design review notes', quote: 'reviewed the retrieval design', claim: false };
    const strengths = [
      ...sara.strengths,
      { text: 'Her retrieval design was reviewed by a second engineer.', citations: [second] },
      { text: 'She kept the harness in use for a year.', citations: sara.strengths[0]?.citations ?? [] },
    ];
    show(page([member('p1', 'Sara Al Qahtani', { status: 'ready', summary: { ...sara, strengths, round1: null } })]));
    const card = screen.getByRole('region', { name: 'Sara Al Qahtani' });
    const list = within(card).getByRole('list', { name: 'Strengths, backed' });
    // Each sentence names its source by number; the same source keeps its number.
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Checked evidence on the heaviest competencies; 412 of 460 commits in her eval harness. [1]',
      'Her retrieval design was reviewed by a second engineer. [2]',
      'She kept the harness in use for a year. [1]',
    ]);
    // One excerpt for the section, not one under every sentence.
    const section = list.parentElement as HTMLElement;
    expect(section.querySelectorAll('mark')).toHaveLength(1);
    expect(within(section).queryByText('reviewed the retrieval design')).toBeNull();
    expect(
      within(within(section).getByRole('list', { name: 'Sources' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['[1]Source: llm-eval-harness', '[2]Source: Design review notes']);
    // A claim's source carries the claim tag in the numbered list too (AGENTS.md 1.6).
    const risks = within(card).getByRole('list', { name: 'Outstanding risks' }).parentElement as HTMLElement;
    expect(within(risks).getByRole('list', { name: 'Sources' }).textContent).toContain('Claim awaiting validation');
    expect(within(card).queryByText('Round 1 finding')).toBeNull();
    expect(card.textContent).not.toContain('None stated in this summary.');
  });

  // AIV-P1-165 section 13 "Ordered, summarised and the recruiter's": the page shows members in the order it is given
  // (loadPack orders them by backed score).
  // SAFETY: mutation check: the `source.claim` line removed from TopSummary -> this test failed (a CV-cited risk read as backed)
  it("Scenario: Ordered, summarised and the recruiter's: the top summary lists each person with scores, one cited strength and one risk, and what separates them", () => {
    show(
      page([
        scored('p1', 'Daniel Novak', 55, 78),
        scored('p2', 'Priya Nair', 49, 77),
        scored('p3', 'Maria Santos', 31, 69),
        { ...scored('p4', 'Omar Haddad', 31, 40), summary: { status: 'preparing' } },
      ]),
    );
    const top = screen.getByRole('region', { name: 'Summary' });
    expect(top.textContent).toContain('In order of backed score, highest first.');
    const rows = within(top)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(rows).toEqual([
      'Daniel Novak · 55 backed by evidence · up to 78 if claims holdHighest backed score in this pack.Strength: Checked evidence on the heaviest competencies; 412 of 460 commits in her eval harness. · Source: llm-eval-harnessRisk: Cost reduction and Arabic work are claims with nothing to inspect. · Source: CV · Claim awaiting validation',
      expect.stringContaining(
        'Priya Nair · 49 backed by evidence · up to 77 if claims hold6 points below Daniel Novak on backed score.',
      ),
      expect.stringContaining(
        'Maria Santos · 31 backed by evidence · up to 69 if claims hold18 points below Priya Nair on backed score.',
      ),
      'Omar Haddad · 31 backed by evidence · up to 40 if claims holdLevel with Maria Santos on backed score. Listed in the order they joined the pack.Preparing summary',
    ]);
    // The cards follow in the same order; the summary links nowhere, so each name is one link (its card's).
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(
      expect.arrayContaining(['Daniel Novak', 'Priya Nair', 'Maria Santos']),
    );
    expect(within(top).queryAllByRole('link')).toEqual([]);
  });

  // AIV-P1-165 section 13 "Agency packs name the client" and "Neutral copy for an in-house team".
  it('Scenario: Agency packs name the client; an in-house pack has no client wording', () => {
    show(page([member('p1', 'Sara Al Qahtani', { status: 'ready', summary: sara })], 'Falcon Pay'));
    expect(screen.getByText('Prepared for Falcon Pay')).toBeTruthy();
    cleanup();
    const { container } = show(page([member('p1', 'Sara Al Qahtani', { status: 'ready', summary: sara })]));
    expect(screen.queryByText(/^Prepared for/)).toBeNull();
    expect(container.textContent).not.toMatch(/client/i);
  });

  // SAFETY: mutation check: set hasFocus to 'no' in SummaryText -> this test failed (no focus)
  // AIV-P2-012 adds the hiring owner's choices: offered, read-only here (no controller), and none pre-selected.
  it('Scenario: The recommendation reads as the recruiter\'s, marked "Prepared with Credalent", and no decision option is pre-selected', () => {
    const huda = { ...sara, recommendation: { ...sara.recommendation, focus: 'Cost and reliability' } };
    show(page([member('p3', 'Huda Al Mansoori', { status: 'ready', summary: huda })]));
    const card = screen.getByRole('region', { name: 'Huda Al Mansoori' });
    expect(within(card).getByText('Your recommendation:').textContent).toBe(
      'Your recommendation: advance, and look into Cost and reliability next [1]',
    );
    expect(within(card).getByText('Prepared with Credalent')).toBeTruthy();
    expect(card.textContent).not.toContain("Credalent's recommendation");
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
    expect(within(card).queryByText('Your recommendation:')).toBeNull();
  });

  it('Scenario: Loading and empty: "Preparing summary" with the scores shown; The empty pack teaches the next step', () => {
    show(page([member('p1', 'Sara Al Qahtani', { status: 'preparing' })]));
    const card = screen.getByRole('region', { name: 'Sara Al Qahtani' });
    expect(within(card).getByRole('status').textContent).toBe('Preparing summary');
    expect(within(card).getByRole('img', { name: '68 backed by evidence · up to 84 if claims hold' })).toBeTruthy();
    cleanup();
    show(page([]));
    expect(
      screen.getByText(
        'This pack has no candidates yet. In the ranking, tick the candidates to decide on, then choose “Add to decision pack”.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to ranking' }).getAttribute('href')).toBe(
      `/app/jobs/${JOB}/candidates`,
    );
    // One way to the ranking, and no summary of nobody.
    expect(screen.queryByRole('link', { name: 'Back to ranking' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Summary' })).toBeNull();
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

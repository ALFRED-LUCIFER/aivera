import { RATINGS as APPLIED } from '@credalent/assessment';
import { RATINGS, type ScorecardDraft } from '@credalent/interviews';
import { describe, expect, it } from 'vitest';
import { effectLines, previewInput, saveDraftInput, startingDraft, type EffectPreview } from './scorecard.ts';

// AIV-P2-004. Synthetic cast and opaque ids only.
const RETRIEVAL = '0190d4a2-0000-7000-9000-000000000040';
const COST = '0190d4a2-0000-7000-9000-000000000041';
const question = (text: string) => ({ text, strongAnswer: '', weakAnswer: '', citations: [] });
const shown = [
  { competencyId: RETRIEVAL, questions: [question('How was the 71% measured?'), question('What changed?')] },
  { competencyId: COST, questions: [] },
];

describe('the scorecard ratings', () => {
  it('are the ratings the assessment applies (AIV-P1-117), in the same order', () => {
    expect(RATINGS).toEqual(APPLIED);
  });
});

describe('startingDraft', () => {
  it('with nothing stored: every competency unrated, every question unmarked, one own-questions entry where none were suggested', () => {
    expect(startingDraft(shown, null)).toEqual({
      competencies: [
        {
          competencyId: RETRIEVAL,
          rating: null,
          note: '',
          questions: [
            { text: 'How was the 71% measured?', mark: null },
            { text: 'What changed?', mark: null },
          ],
        },
        { competencyId: COST, rating: null, note: '', questions: [{ text: '', mark: null }] },
      ],
      recommendation: null,
    });
  });

  it('keeps the stored rating, note and recommendation, and a mark only for the same question', () => {
    const stored: ScorecardDraft = {
      competencies: [
        {
          competencyId: RETRIEVAL,
          rating: 'clearly_shown',
          note: 'Walked through the 200-question set he built',
          // Suggested again since: "What changed?" is still asked, the other question is gone.
          questions: [
            { text: 'Who built the set?', mark: 'not_asked' },
            { text: 'What changed?', mark: 'not_answered' },
          ],
        },
        { competencyId: COST, rating: null, note: '', questions: [{ text: '', mark: 'not_asked' }] },
      ],
      recommendation: 'more_evidence',
    };
    const draft = startingDraft(shown, stored);
    expect(draft.competencies[0]).toMatchObject({
      rating: 'clearly_shown',
      note: 'Walked through the 200-question set he built',
      questions: [
        { text: 'How was the 71% measured?', mark: null },
        { text: 'What changed?', mark: 'not_answered' },
      ],
    });
    expect(draft.competencies[1]?.questions).toEqual([{ text: '', mark: 'not_asked' }]);
    expect(draft.recommendation).toBe('more_evidence');
  });
});

describe('saveDraftInput', () => {
  it('takes an interview id and a draft, and nothing else', () => {
    const draft = startingDraft(shown, null);
    expect(saveDraftInput.safeParse({ interviewId: RETRIEVAL, draft }).success).toBe(true);
    expect(saveDraftInput.safeParse({ interviewId: 'daniel', draft }).success).toBe(false);
    expect(saveDraftInput.safeParse({ interviewId: RETRIEVAL, draft: { ...draft, overallScore: 4 } }).success).toBe(
      false,
    );
  });
});

// AIV-P2-005: Daniel Novak's "Retrieval and evaluation" rests on a CV claim stored as Supporting; his backed score is 55.
// The states are the assessment's own preview (AIV-P1-117); here only how the panel reads them.
const daniel = [
  {
    competencyId: RETRIEVAL,
    name: 'Retrieval and evaluation',
    evidence: { lead: { strength: 'supporting' as const } },
  },
  { competencyId: COST, name: 'Cost and reliability', evidence: null },
];
type CompetencyState = EffectPreview['changes'][number]['from'];
const state = (strength: CompetencyState['strength'], provenLevel: CompetencyState['provenLevel'] = 0) => ({
  strength,
  provenLevel,
});
const effect = (from: CompetencyState, to: CompetencyState, score: [number, number]): EffectPreview => ({
  backedScore: { from: score[0], to: score[1] },
  changes: [{ competencyId: RETRIEVAL, from, to }],
});
const unchanged: EffectPreview = { backedScore: { from: 55, to: 55 }, changes: [] };
const line = (rating: (typeof RATINGS)[number], preview: EffectPreview) =>
  effectLines([{ competencyId: RETRIEVAL, rating }], preview, daniel);

describe('effectLines', () => {
  it.each([
    ['not_shown', effect(state('supporting'), state('claim'), [55, 55]), 'weakened', 'supporting', 'claim'],
    ['partly_shown', unchanged, 'unchanged', 'supporting', 'supporting'],
    [
      'clearly_shown',
      effect(state('supporting'), state('medium', 3), [55, 67]),
      'strengthened',
      'supporting',
      'medium',
    ],
    [
      'strongly_shown',
      effect(state('supporting'), state('medium', 3), [55, 67]),
      'strengthened',
      'supporting',
      'medium',
    ],
  ] as const)('%s reads %s from %s to %s', (rating, preview, direction, from, to) => {
    expect(line(rating, preview)).toEqual([
      { competencyId: RETRIEVAL, name: 'Retrieval and evaluation', direction, from, to },
    ]);
  });

  it('a rating that moves nothing reads "No change", and a level gained at the same strength is strengthened', () => {
    expect(line('clearly_shown', effect(state('strong', 4), state('strong', 4), [70, 70]))[0]?.direction).toBe(
      'unchanged',
    );
    expect(line('clearly_shown', effect(state('medium', 2), state('medium', 3), [55, 58]))[0]?.direction).toBe(
      'strengthened',
    );
    expect(line('clearly_shown', effect(state(null), state('medium', 3), [55, 67]))[0]).toMatchObject({
      direction: 'strengthened',
      from: null,
      to: 'medium',
    });
  });

  it('lists every rating in the order sent, and a competency with no evidence stays at none', () => {
    const preview: EffectPreview = {
      backedScore: { from: 55, to: 55 },
      changes: [{ competencyId: RETRIEVAL, from: state('supporting'), to: state('claim') }],
    };
    expect(
      effectLines(
        [
          { competencyId: COST, rating: 'partly_shown' },
          { competencyId: RETRIEVAL, rating: 'not_shown' },
        ],
        preview,
        daniel,
      ).map((l) => [l.name, l.direction, l.from, l.to]),
    ).toEqual([
      ['Cost and reliability', 'unchanged', null, null],
      ['Retrieval and evaluation', 'weakened', 'supporting', 'claim'],
    ]);
  });
});

describe('previewInput', () => {
  it('takes an interview id and at least one rating of a competency, and nothing else', () => {
    const ratings = [{ competencyId: RETRIEVAL, rating: 'strongly_shown' }];
    expect(previewInput.safeParse({ interviewId: COST, ratings }).success).toBe(true);
    expect(previewInput.safeParse({ interviewId: COST, ratings: [] }).success).toBe(false);
    expect(previewInput.safeParse({ interviewId: COST, ratings: [{ ...ratings[0], rating: 'strong' }] }).success).toBe(
      false,
    );
    expect(previewInput.safeParse({ interviewId: COST, ratings, assessmentId: RETRIEVAL }).success).toBe(false);
  });
});

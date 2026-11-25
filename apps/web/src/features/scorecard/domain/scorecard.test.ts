import { RATINGS as APPLIED } from '@credalent/assessment';
import { RATINGS, type ScorecardDraft } from '@credalent/interviews';
import { describe, expect, it } from 'vitest';
import { saveDraftInput, startingDraft } from './scorecard.ts';

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

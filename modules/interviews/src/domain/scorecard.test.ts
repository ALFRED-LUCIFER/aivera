import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  assessedRatings,
  MARKS,
  NOT_SHOWN_REASON,
  notAssessed,
  nothingAssessed,
  ratingReason,
  rebuildDraft,
  scorecardDraftSchema,
  toInterviewNoteEvidence,
  unexplained,
  type DraftCompetency,
  type ScorecardDraft,
} from './scorecard.ts';

// AIV-P2-004: Daniel Novak's Round 1 scorecard (synthetic cast, opaque ids).
const id = (n: number) => `0190d4a2-0000-7000-9000-${String(n).padStart(12, '0')}`;
const RETRIEVAL = id(40);
const COST = id(41);
const INTERVIEW = id(60);
const AYESHA = id(1);
const NOTE = 'Walked through the 200-question set he built';

const competency = (over: Partial<DraftCompetency>): DraftCompetency => ({
  competencyId: COST,
  rating: null,
  note: '',
  questions: [
    { text: 'In the March incident, what did you do in the first thirty minutes?', mark: null },
    { text: 'What would you watch to catch it earlier next time?', mark: null },
  ],
  ...over,
});
const allMarked = (mark: (typeof MARKS)[number], over: Partial<DraftCompetency> = {}) =>
  competency({ ...over, questions: competency({}).questions.map((q) => ({ ...q, mark })) });
const rated = competency({ competencyId: RETRIEVAL, rating: 'clearly_shown', note: NOTE });
const draft = (...competencies: DraftCompetency[]): ScorecardDraft => ({ competencies, recommendation: null });
const scorecard = (...competencies: DraftCompetency[]) => ({
  interviewId: INTERVIEW,
  authorMemberId: AYESHA,
  draft: draft(...competencies),
});

describe('Scenario Outline: A competency that was not tested stays a gap', () => {
  // SAFETY: mutation check: made assessedRatings give an all-marked competency the rating 'not_shown' -> these tests failed (a "Not shown" change for Cost and reliability)
  it.each(MARKS)('every question marked %s: not assessed, no strength change and no evidence payload', (mark) => {
    // Even a rating given before the questions were marked carries nothing.
    for (const cost of [allMarked(mark), allMarked(mark, { rating: 'not_shown', note: 'Could not say' })]) {
      expect(notAssessed(cost)).toBe(true);
      expect(assessedRatings(draft(rated, cost)).map((r) => r.competencyId)).toEqual([RETRIEVAL]);
      expect(toInterviewNoteEvidence(scorecard(rated, cost)).map((p) => p.competencyId)).toEqual([RETRIEVAL]);
      expect(nothingAssessed(draft(cost))).toBe(false);
    }
  });

  it('one question still open, or no question at all, is not "not assessed"', () => {
    const questions = competency({}).questions.map((q, i) => ({ ...q, mark: i === 0 ? ('not_asked' as const) : null }));
    expect(notAssessed({ questions })).toBe(false);
    expect(notAssessed({ questions: [] })).toBe(false);
  });
});

describe('Scenario: Notes become interview_note evidence payloads', () => {
  it('a rated competency gives one payload with the author, the rating, the note and the interview', () => {
    expect(toInterviewNoteEvidence(scorecard(rated, competency({})))).toEqual([
      {
        kind: 'interview_note',
        interviewId: INTERVIEW,
        competencyId: RETRIEVAL,
        authorMemberId: AYESHA,
        rating: 'clearly_shown',
        note: NOTE,
      },
    ]);
  });
});

describe('Scenario: Rate only what was tested (AIV-P1-165 §12)', () => {
  it('one rated competency is enough: the one left unrated blocks nothing and carries no rating', () => {
    const one = draft(rated, competency({}));
    expect(nothingAssessed(one)).toBe(false);
    // SAFETY: mutation check: gave an unrated competency the rating 'not_shown' in assessedRatings -> this test failed
    // (Cost and reliability, never tested, was scored down).
    expect(assessedRatings(one).map((r) => r.competencyId)).toEqual([RETRIEVAL]);
    expect(toInterviewNoteEvidence(scorecard(rated, competency({}))).map((p) => p.competencyId)).toEqual([RETRIEVAL]);
  });

  it('a scorecard with nothing rated and nothing marked is not submitted', () => {
    expect(nothingAssessed(draft(competency({}), competency({ competencyId: RETRIEVAL })))).toBe(true);
    // An interview that tests no competency of the approved rubric has nothing to rate.
    expect(nothingAssessed(draft())).toBe(false);
  });

  it('"Not shown" needs no note, and is logged with its own reason; every other rating needs one', () => {
    const notShown = competency({ rating: 'not_shown' });
    const partly = competency({ competencyId: RETRIEVAL, rating: 'partly_shown', note: ' ' });
    expect(unexplained(draft(notShown, partly))).toEqual([RETRIEVAL]);
    expect(ratingReason({ note: '' })).toBe(NOT_SHOWN_REASON);
    expect(ratingReason({ note: NOTE })).toBe(NOTE);
  });
});

describe('AIV-P2-006: what a submit reads', () => {
  // SAFETY: mutation check: put the note limit back to 4,000 -> this test failed (a 1,001-character note was taken,
  // which the assessment then refuses as a reason, so the scorecard could never be submitted).
  it('a note is at most 1,000 characters, the most the assessment logs as a reason', () => {
    for (const [length, taken] of [
      [1000, true],
      [1001, false],
    ] as const) {
      const noted = {
        competencies: [competency({ rating: 'partly_shown', note: 'x'.repeat(length) })],
        recommendation: null,
      };
      expect(scorecardDraftSchema.safeParse(noted).success).toBe(taken);
    }
  });

  it('a rating with nothing under "What you saw or heard" blocks it; a competency not assessed needs no note', () => {
    const notAsked = competency({ questions: [{ text: 'Q', mark: 'not_asked' }], rating: 'not_shown' });
    const noNote = competency({ competencyId: RETRIEVAL, rating: 'partly_shown', note: ' ' });
    expect(unexplained({ competencies: [noNote, notAsked], recommendation: null })).toEqual([RETRIEVAL]);
  });

  it('rebuilds each competency on the questions shown now, keeping the marks stored for the same words', () => {
    const stored: ScorecardDraft = {
      competencies: [
        competency({
          rating: 'clearly_shown',
          note: NOTE,
          questions: [
            { text: 'Shown', mark: 'not_asked' },
            { text: 'Made up', mark: 'not_answered' },
          ],
        }),
      ],
      recommendation: 'shortlist',
    };
    expect(
      rebuildDraft(
        [
          { competencyId: COST, questions: ['Shown', 'Also shown'] },
          { competencyId: RETRIEVAL, questions: [] },
        ],
        stored,
      ),
    ).toEqual({
      competencies: [
        {
          competencyId: COST,
          rating: 'clearly_shown',
          note: NOTE,
          questions: [
            { text: 'Shown', mark: 'not_asked' },
            { text: 'Also shown', mark: null },
          ],
        },
        { competencyId: RETRIEVAL, rating: null, note: '', questions: [{ text: '', mark: null }] },
      ],
      recommendation: 'shortlist',
    });
  });
});

describe('Scenario: No AI or overall judgement of the person', () => {
  it('the schema holds a rating, a note and question marks per competency, and a recommendation: nothing else', () => {
    const schema = z.toJSONSchema(scorecardDraftSchema);
    expect(JSON.stringify(schema)).not.toMatch(/overall|summary|communication|english|confidence|attitude|soft|score/i);
    expect(schema).toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "additionalProperties": false,
        "properties": {
          "competencies": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "competencyId": {
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
                  "type": "string",
                },
                "note": {
                  "maxLength": 1000,
                  "type": "string",
                },
                "questions": {
                  "items": {
                    "additionalProperties": false,
                    "properties": {
                      "mark": {
                        "anyOf": [
                          {
                            "enum": [
                              "not_asked",
                              "not_answered",
                            ],
                            "type": "string",
                          },
                          {
                            "type": "null",
                          },
                        ],
                      },
                      "text": {
                        "maxLength": 2000,
                        "type": "string",
                      },
                    },
                    "required": [
                      "text",
                      "mark",
                    ],
                    "type": "object",
                  },
                  "maxItems": 20,
                  "type": "array",
                },
                "rating": {
                  "anyOf": [
                    {
                      "enum": [
                        "not_shown",
                        "partly_shown",
                        "clearly_shown",
                        "strongly_shown",
                      ],
                      "type": "string",
                    },
                    {
                      "type": "null",
                    },
                  ],
                },
              },
              "required": [
                "competencyId",
                "rating",
                "note",
                "questions",
              ],
              "type": "object",
            },
            "maxItems": 50,
            "type": "array",
          },
          "recommendation": {
            "anyOf": [
              {
                "enum": [
                  "shortlist",
                  "more_evidence",
                  "not_recommended",
                ],
                "type": "string",
              },
              {
                "type": "null",
              },
            ],
          },
        },
        "required": [
          "competencies",
          "recommendation",
        ],
        "type": "object",
      }
    `);
  });

  it('refuses a field the schema does not name', () => {
    expect(scorecardDraftSchema.safeParse({ ...draft(rated), overallScore: 4 }).success).toBe(false);
    expect(scorecardDraftSchema.safeParse(draft({ ...rated, confidence: 'high' } as DraftCompetency)).success).toBe(
      false,
    );
    expect(scorecardDraftSchema.safeParse(draft(rated)).success).toBe(true);
  });
});

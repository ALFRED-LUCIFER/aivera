import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  assessedRatings,
  MARKS,
  notAssessed,
  scorecardDraftSchema,
  toInterviewNoteEvidence,
  unrated,
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
      expect(unrated(draft(rated, cost))).toEqual([]);
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

describe('Scenario: Submit needs every competency rated or marked not tested', () => {
  it('names the competency that is neither rated nor marked', () => {
    expect(unrated(draft(rated, competency({})))).toEqual([COST]);
    expect(unrated(draft(rated, competency({ rating: 'not_shown' })))).toEqual([]);
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
                  "maxLength": 4000,
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

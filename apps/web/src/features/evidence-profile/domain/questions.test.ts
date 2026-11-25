import type { SuggestedQuestions } from '@credalent/assessment';
import type { EvidenceItemView } from '@credalent/evidence';
import { describe, expect, it } from 'vitest';
import { questionsView } from './questions.ts';

// AIV-P1-113: the stored questions as the browser shows them. Synthetic cast only (Daniel Novak).
const item = (id: string, kind: string, label: string, more: object) =>
  ({
    id,
    excerpt: 'raised answer accuracy from 71% to 88%',
    excerptSpan: 'page 1',
    strength: 'supporting',
    provenance: 'claim',
    source: { id: `s-${id}`, kind, label, url: null },
    ...more,
  }) as unknown as EvidenceItemView;
const evidence = [
  item('i-cv', 'cv', 'CV', {}),
  item('i-doc', 'document', 'Cost write-up', { excerptSpan: null, strength: 'medium', provenance: 'submitted' }),
];
const question = (citations: { itemId: string | null; quote: string }[]) => ({
  text: 'How was the 71% measured, on which questions, and who built that set?',
  strongAnswer: 'Names the set.',
  weakAnswer: 'Repeats the figure.',
  citations,
});
const stored = (gaps: { competencyId: string; questions: ReturnType<typeof question>[] }[]): SuggestedQuestions => ({
  status: 'suggested',
  resultId: 'r1',
  stale: false,
  gaps,
  suggestedAt: new Date('2026-11-25T08:00:00.000Z'),
});
const names = new Map([['c-retrieval', 'Retrieval and evaluation']]);

describe('questionsView', () => {
  it('names each gap by its competency and each citation by its source, "CV, page 1"', () => {
    const view = questionsView(
      stored([{ competencyId: 'c-retrieval', questions: [question([{ itemId: 'i-cv', quote: 'from 71% to 88%' }])] }]),
      names,
      evidence,
    );
    expect(view).toEqual({
      status: 'suggested',
      stale: false,
      gaps: [
        {
          competencyId: 'c-retrieval',
          name: 'Retrieval and evaluation',
          questions: [
            {
              text: 'How was the 71% measured, on which questions, and who built that set?',
              strongAnswer: 'Names the set.',
              weakAnswer: 'Repeats the figure.',
              citations: [{ key: 'i-cv:0', quote: 'from 71% to 88%', label: 'CV, page 1', highlighted: false }],
            },
          ],
        },
      ],
    });
  });

  // SAFETY: mutation check: `highlighted` set true for every cited item -> this test failed (the CV claim was highlighted)
  it("highlights inspected work only: a claim's words stay plain, and so does the rubric line (AGENTS.md 1.6)", () => {
    const view = questionsView(
      stored([
        {
          competencyId: 'c-retrieval',
          questions: [
            question([
              { itemId: 'i-cv', quote: 'from 71% to 88%' },
              { itemId: 'i-doc', quote: 'answer accuracy' },
              { itemId: null, quote: 'Eval sets' },
              { itemId: 'gone', quote: 'no longer listed' },
            ]),
          ],
        },
      ]),
      names,
      evidence,
    );
    if (view.status !== 'suggested') throw new Error('not suggested');
    expect(view.gaps[0]?.questions[0]?.citations.map((c) => [c.label, c.highlighted])).toEqual([
      ['CV, page 1', false],
      ['Cost write-up', true],
      [null, false],
    ]);
  });

  it('leaves out a gap the approved rubric does not name, and passes the other states through without their ids', () => {
    expect(questionsView(stored([{ competencyId: 'c-old', questions: [] }]), names, evidence)).toMatchObject({
      gaps: [],
    });
    expect(questionsView({ status: 'no_gaps', resultId: 'r1' }, names, evidence)).toEqual({ status: 'no_gaps' });
    expect(questionsView({ status: 'not_suggested', resultId: 'r1' }, names, evidence)).toEqual({
      status: 'not_suggested',
    });
  });
});

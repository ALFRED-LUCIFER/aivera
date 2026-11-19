import type { Rubric } from '@aivera/jobs';
import { describe, expect, it } from 'vitest';
import { rubricView, weightsTotal } from './rubric.ts';

const HEAD = 'head-id';
const at = new Date('2026-11-12T08:00:00.000Z');
const version = (n: number, status: Rubric['status'], more: Partial<Rubric> = {}): Rubric =>
  ({
    version: n,
    status,
    successStatement: `v${n}`,
    changeNote: null,
    approvedBy: null,
    approvedAt: null,
    competencies: [],
    ...more,
  }) as Rubric;

describe('Rubric page view (AIV-P1-012)', () => {
  it('shows the approved version; a superseded version carries the change that replaced it', () => {
    const view = rubricView(
      [
        version(3, 'draft', { changeNote: 'Cost and reliability raised from 15% to 20%.' }),
        version(2, 'approved', {
          approvedBy: HEAD,
          approvedAt: at,
          changeNote: 'Product judgement raised from 10% to 15%; Arabic NLP changed to desirable.',
        }),
        version(1, 'superseded', { approvedBy: HEAD, approvedAt: at }),
      ],
      new Map([[HEAD, 'Head of Engineering']]),
    );
    expect(view.shown?.successStatement).toBe('v2');
    expect(view.history).toEqual([
      { version: 3, status: 'draft', approved: null, note: 'Cost and reliability raised from 15% to 20%.' },
      { version: 2, status: 'approved', approved: { by: 'Head of Engineering', at }, note: null },
      {
        version: 1,
        status: 'superseded',
        approved: null,
        note: 'Product judgement raised from 10% to 15%; Arabic NLP changed to desirable.',
      },
    ]);
  });

  it('with none approved, shows the latest draft; with no versions, nothing', () => {
    expect(rubricView([version(1, 'draft')], new Map()).shown?.version).toBe(1);
    expect(rubricView([], new Map())).toEqual({ shown: null, history: [] });
  });

  it('totals the weights', () => {
    expect(weightsTotal([25, 20, 15, 15, 10, 15].map((weightPercent) => ({ weightPercent })))).toBe(100);
  });
});

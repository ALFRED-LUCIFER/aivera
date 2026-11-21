import { describe, expect, it } from 'vitest';
import { CATALOGUE_V1 } from '../infrastructure/catalogue-v1.fixture.ts';
import type { EditorVersion } from './catalogue-draft.ts';
import { catalogueDiff, diffCounts } from './catalogue-diff.ts';

// AIV-P2-049: the publish preview's diff (ADR-013 point 13). Synthetic catalogue text only.

const v1: EditorVersion = {
  ...CATALOGUE_V1,
  packs: CATALOGUE_V1.packs.map((p) => ({
    ...p,
    competencies: p.competencies.map((c, position) => ({ ...c, position })),
    hints: p.hints.map((h, i) => ({ ...h, position: p.hints.slice(0, i).filter((o) => o.region === h.region).length })),
  })),
};
const LEDGER = 'Ledger and double-entry accounting';

/** The draft of the ticket's scenario: adds Insurance, renames Telecom, retires the ledger competency. */
const draft: EditorVersion = {
  ...v1,
  version: 2,
  packs: [
    ...v1.packs.map((p) => ({
      ...p,
      ...(p.key === 'telecom' && { label: { en: 'Telecom and 5G' } }),
      competencies: p.competencies.map((c) => (c.name === LEDGER ? { ...c, retired: true } : c)),
    })),
    { key: 'insurance', label: { en: 'Insurance and insurtech' }, retired: false, competencies: [], hints: [] },
  ],
};

describe('catalogueDiff', () => {
  it('nothing changed: no changes', () => {
    expect(catalogueDiff(v1, structuredClone(v1))).toEqual([]);
  });

  it('lists added, edited (field, before and after) and retired entries, grouped, in draft order', () => {
    const changes = catalogueDiff(v1, draft);
    expect(changes).toEqual([
      {
        group: 'packs',
        kind: 'edited',
        id: 'telecom',
        name: 'Telecom',
        fields: [{ field: 'label', before: 'Telecom', after: 'Telecom and 5G' }],
      },
      { group: 'packs', kind: 'added', id: 'insurance', name: 'Insurance and insurtech', fields: [] },
      {
        group: 'competencies',
        kind: 'retired',
        id: expect.stringMatching(/^payments_fintech:\d+$/),
        name: LEDGER,
        fields: [],
      },
    ]);
    expect(diffCounts(changes)).toEqual({ added: 1, edited: 1, retired: 1 });
  });

  it('an edited competency, job type or hint names each changed field; an already retired entry is no change', () => {
    const before: EditorVersion = {
      ...v1,
      packs: v1.packs.map((p) => (p.key === 'healthcare' ? { ...p, retired: true } : p)),
    };
    const after: EditorVersion = {
      ...before,
      jobTypes: before.jobTypes.map((t) =>
        t.key === 'sales' ? { ...t, starterCompetencies: ['A', 'B', 'C', 'D'] } : t,
      ),
      packs: before.packs.map((p) =>
        p.key === 'payments_fintech'
          ? {
              ...p,
              competencies: p.competencies.map((c, i) =>
                i === 0 ? { ...c, meaning: 'New meaning', levels: { ...c.levels, 3: 'New level 3' } } : c,
              ),
              hints: p.hints.map((h, i) => (i === 0 ? { ...h, appliesTo: ['sales'] } : h)),
            }
          : p,
      ),
    };
    const changes = catalogueDiff(before, after);
    expect(changes.map((c) => [c.group, c.kind, c.fields.map((f) => f.field)])).toEqual([
      ['jobTypes', 'edited', ['starters']],
      ['competencies', 'edited', ['meaning', 'level3']],
      ['hints', 'edited', ['appliesTo']],
    ]);
    expect(changes[2]?.fields[0]?.after).toBe('sales');
  });

  it('a reorder of published job types is one change; a new job type is only added', () => {
    const [first, second, ...rest] = v1.jobTypes;
    if (!first || !second) throw new Error('fixture');
    const added = { ...first, key: 'security_engineering', label: { en: 'Security engineering' } };
    const changes = catalogueDiff(v1, { ...v1, jobTypes: [added, second, first, ...rest] });
    expect(changes.map((c) => [c.kind, c.id])).toEqual([
      ['added', 'security_engineering'],
      ['edited', 'order'],
    ]);
    expect(catalogueDiff(v1, { ...v1, jobTypes: [added, ...v1.jobTypes] }).map((c) => c.id)).toEqual([
      'security_engineering',
    ]);
  });
});

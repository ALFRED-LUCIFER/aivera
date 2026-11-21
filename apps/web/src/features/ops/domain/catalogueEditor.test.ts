import { describe, expect, it } from 'vitest';
import {
  competencyFormFor,
  draftPackSchema,
  invalidResult,
  newCompetencyForm,
  toggleJobType,
} from './catalogueEditor.ts';

// AIV-P2-045: the editor's form rules.
describe('toggleJobType', () => {
  const form = newCompetencyForm('insurance');

  it('ticking a default suggestion also applies the job type; unticking applies-to drops it from core', () => {
    const core = toggleJobType(form, 'core', 'software_engineering');
    expect(core).toMatchObject({ appliesTo: ['software_engineering'], core: ['software_engineering'] });
    expect(toggleJobType(core, 'appliesTo', 'software_engineering')).toMatchObject({ appliesTo: [], core: [] });
    expect(toggleJobType(core, 'core', 'software_engineering')).toMatchObject({
      appliesTo: ['software_engineering'],
      core: [],
    });
  });
});

describe('invalidResult', () => {
  it('names the first field the schema refused', () => {
    const refused = draftPackSchema.safeParse({ version: 2, revision: 0, previousKey: null, key: 'X', label: '' });
    expect(refused.success).toBe(false);
    if (!refused.success) expect(invalidResult(refused.error)).toEqual({ ok: false, error: 'invalid', field: 'key' });
  });
});

// AIV-P2-046: a regional hint's form is the competency form with a region; its row has no core.
describe('hint forms', () => {
  it('a hint form keeps its region; a competency form has none', () => {
    expect(newCompetencyForm('telecom', 'india')).toMatchObject({ packKey: 'telecom', region: 'india', core: [] });
    expect(newCompetencyForm('telecom').region).toBeNull();
    const row = {
      region: 'ksa',
      position: 0,
      name: 'FASAH customs platform',
      meaning: 'Customs clearance.',
      evidence: 'Integration code',
      levels: { 1: 'a', 3: 'b', 5: 'c' },
      appliesTo: ['software_engineering'],
      levelNeeded: 2,
      status: 'live' as const,
      removable: false,
    };
    expect(competencyFormFor('logistics_mobility', row)).toMatchObject({ region: 'ksa', position: 0, core: [] });
  });
});

import { describe, expect, it } from 'vitest';
import {
  draftPackSchema,
  invalidResult,
  jobTypeFormFor,
  jobTypeInput,
  newCompetencyForm,
  newJobTypeForm,
  toggleJobType,
  type DraftModel,
  type JobTypeRow,
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

// AIV-P2-047: the job type form counts positions from 1 in the Add a job list; the save sends them from 0.
const row = (key: string): JobTypeRow => ({
  key,
  label: key,
  evidence: 'e',
  starters: ['a', 'b', 'c', 'd'],
  status: 'live',
});

describe('the job type form', () => {
  const draft: DraftModel = {
    version: 2,
    revision: 3,
    jobTypes: [
      { key: 'sales', label: 'Sales' },
      { key: 'product_design', label: 'Product design' },
    ],
    jobTypeEntries: [row('sales'), row('product_design')],
    packs: [],
  };

  it('a new job type goes last; an edited one starts where it is', () => {
    expect(newJobTypeForm(draft)).toMatchObject({ adding: true, position: 3, starters: ['', '', '', ''] });
    expect(jobTypeFormFor(draft, row('product_design'))).toMatchObject({ adding: false, position: 2 });
    expect(jobTypeInput(draft, { ...newJobTypeForm(draft), key: ' security_engineering ', position: 1 })).toMatchObject(
      { version: 2, revision: 3, key: 'security_engineering', position: 0 },
    );
  });
});

import { describe, expect, it } from 'vitest';
import { CATALOGUE_V1 } from '@/test/catalogue-v1.ts';
import { defaultJobType, descriptionPlaceholder, jobTypeOptions, parseNewJobForm } from './jobNew.ts';

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const owner = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

describe('parseNewJobForm', () => {
  it('accepts a one-line description and drops empty optional fields', () => {
    expect(
      parseNewJobForm(
        form({ jobType: 'ai_llm_engineering', title: ' Senior AI Engineer ', description: 'LLM work.', team: ' ' }),
        CATALOGUE_V1,
      ),
    ).toEqual({
      input: {
        jobType: 'ai_llm_engineering',
        title: 'Senior AI Engineer',
        description: 'LLM work.',
        team: null,
        clientId: null,
        location: null,
        hiringOwnerUserId: null,
      },
    });
  });

  it('keeps a hiring owner id', () => {
    const parsed = parseNewJobForm(
      form({ jobType: 'sales', title: 'Account Executive', hiringOwnerUserId: owner }),
      CATALOGUE_V1,
    );
    expect('input' in parsed && parsed.input.hiringOwnerUserId).toBe(owner);
  });

  it('asks for a title and a job type, keeping what was typed', () => {
    expect(parseNewJobForm(form({ title: '  ', description: 'Thin.' }), CATALOGUE_V1)).toEqual({
      state: {
        errors: { title: true, jobType: true },
        error: null,
        saved: false,
        values: {
          jobType: '',
          title: '  ',
          description: 'Thin.',
          team: '',
          clientId: '',
          location: '',
          hiringOwnerUserId: '',
        },
      },
    });
  });

  it.each([
    { jobType: 'astrology', title: 'x' },
    { jobType: 'sales', title: 'x'.repeat(201) },
    { jobType: 'sales', title: 'x', hiringOwnerUserId: 'not-an-id' },
    { jobType: 'sales', title: 'x', clientId: "' or 1=1" },
  ])('refuses a forged or over-long %o', (fields) => {
    const parsed = parseNewJobForm(form(fields), CATALOGUE_V1);
    expect('state' in parsed && parsed.state.error).toBe(fields.jobType === 'astrology' ? null : 'failed');
  });

  it('AIV-P2-044: refuses a job type the published catalogue retired, as one it never had', () => {
    const retired = {
      ...CATALOGUE_V1,
      jobTypes: CATALOGUE_V1.jobTypes.map((t) => ({ ...t, retired: t.key === 'sales' })),
    };
    const parsed = parseNewJobForm(form({ jobType: 'sales', title: 'Account Executive' }), retired);
    expect('state' in parsed && parsed.state.errors).toEqual({ jobType: true });
  });
});

describe('descriptionPlaceholder', () => {
  it.each([
    ['software_engineering', 'System design in production'],
    ['ai_llm_engineering', 'LLM systems in production'],
    ['sales', 'Closing sales'],
    ['qa_test_automation', 'Test automation design'],
    ['product_design', 'Interaction design craft'],
    ['technical_writing_support', 'Clear task documentation'],
  ])('lists the %s starters, %s first', (jobType, first) => {
    const starters = jobTypeOptions(CATALOGUE_V1).find((o) => o.value === jobType)?.starters ?? [];
    const lines = descriptionPlaceholder('What this person must be able to do:', starters).split('\n');
    expect(lines[0]).toBe('What this person must be able to do:');
    expect(lines[1]).toBe(`- ${first}`);
    expect(lines).toHaveLength(5);
  });

  it('is the intro alone before a job type is chosen', () => {
    expect(descriptionPlaceholder('Intro', [])).toBe('Intro');
  });
});

describe('defaultJobType', () => {
  it('preselects a hiring focus that is a job type, and nothing for a catch-all', () => {
    expect(defaultJobType('data_ml', CATALOGUE_V1)).toBe('data_ml');
    expect(defaultJobType('several', CATALOGUE_V1)).toBe('');
    const retired = {
      ...CATALOGUE_V1,
      jobTypes: CATALOGUE_V1.jobTypes.map((t) => ({ ...t, retired: t.key === 'data_ml' })),
    };
    expect(defaultJobType('data_ml', retired)).toBe('');
  });
});

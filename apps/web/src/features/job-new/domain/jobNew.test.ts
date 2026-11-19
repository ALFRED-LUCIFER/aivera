import { describe, expect, it } from 'vitest';
import { defaultJobType, descriptionPlaceholder, parseNewJobForm } from './jobNew.ts';

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
    const parsed = parseNewJobForm(form({ jobType: 'sales', title: 'Account Executive', hiringOwnerUserId: owner }));
    expect('input' in parsed && parsed.input.hiringOwnerUserId).toBe(owner);
  });

  it('asks for a title and a job type, keeping what was typed', () => {
    expect(parseNewJobForm(form({ title: '  ', description: 'Thin.' }))).toEqual({
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
    const parsed = parseNewJobForm(form(fields));
    expect('state' in parsed && parsed.state.error).toBe(fields.jobType === 'astrology' ? null : 'failed');
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
    const lines = descriptionPlaceholder('What this person must be able to do:', jobType).split('\n');
    expect(lines[0]).toBe('What this person must be able to do:');
    expect(lines[1]).toBe(`- ${first}`);
    expect(lines).toHaveLength(5);
  });

  it('is the intro alone before a job type is chosen', () => {
    expect(descriptionPlaceholder('Intro', '')).toBe('Intro');
  });
});

describe('defaultJobType', () => {
  it('preselects a hiring focus that is a job type, and nothing for a catch-all', () => {
    expect(defaultJobType('data_ml')).toBe('data_ml');
    expect(defaultJobType('several')).toBe('');
  });
});

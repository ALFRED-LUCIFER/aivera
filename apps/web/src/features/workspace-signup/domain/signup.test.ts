import { describe, expect, it } from 'vitest';
import { CATALOGUE_V1 } from '@/test/catalogue-v1.ts';
import { parseCreateWorkspaceForm, workspaceName } from './signup';

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe('parseCreateWorkspaceForm', () => {
  it('keeps a trimmed company and a known hiring focus', () => {
    expect(
      parseCreateWorkspaceForm(form({ company: '  Demo Hiring Co ', hiringFocus: 'ai_llm_engineering' }), CATALOGUE_V1),
    ).toEqual({
      company: 'Demo Hiring Co',
      hiringFocus: 'ai_llm_engineering',
    });
  });

  it('accepts an empty or missing company (Company is optional)', () => {
    expect(parseCreateWorkspaceForm(form({ hiringFocus: 'sales' }), CATALOGUE_V1)).toEqual({
      company: '',
      hiringFocus: 'sales',
    });
  });

  it('takes the catch-alls, and refuses a job type the published catalogue retired', () => {
    expect(parseCreateWorkspaceForm(form({ hiringFocus: 'several' }), CATALOGUE_V1)).toEqual({
      company: '',
      hiringFocus: 'several',
    });
    const retired = { ...CATALOGUE_V1, jobTypes: CATALOGUE_V1.jobTypes.map((t) => ({ ...t, retired: true })) };
    expect(parseCreateWorkspaceForm(form({ hiringFocus: 'sales' }), retired)).toBeNull();
  });

  it.each([{}, { hiringFocus: 'astrology' }, { hiringFocus: 'sales', company: 'x'.repeat(201) }])(
    'refuses %o',
    (fields) => {
      expect(parseCreateWorkspaceForm(form(fields), CATALOGUE_V1)).toBeNull();
    },
  );
});

describe('workspaceName (Scenario: A solo recruiter signs up with no company)', () => {
  it('is the company, or the person when there is none', () => {
    expect(workspaceName('Demo Hiring Co', 'Alex Recruiter')).toBe('Demo Hiring Co');
    expect(workspaceName('', 'Nadia Freelance')).toBe('Nadia Freelance');
  });
});

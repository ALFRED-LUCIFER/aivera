import { describe, expect, it } from 'vitest';
import { parseCreateWorkspaceForm, workspaceName } from './signup';

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe('parseCreateWorkspaceForm', () => {
  it('keeps a trimmed company and a known hiring focus', () => {
    expect(parseCreateWorkspaceForm(form({ company: '  Demo Hiring Co ', hiringFocus: 'ai_llm_engineering' }))).toEqual(
      {
        company: 'Demo Hiring Co',
        hiringFocus: 'ai_llm_engineering',
      },
    );
  });

  it('accepts an empty or missing company (Company is optional)', () => {
    expect(parseCreateWorkspaceForm(form({ hiringFocus: 'sales' }))).toEqual({ company: '', hiringFocus: 'sales' });
  });

  it.each([{}, { hiringFocus: 'astrology' }, { hiringFocus: 'sales', company: 'x'.repeat(201) }])(
    'refuses %o',
    (fields) => {
      expect(parseCreateWorkspaceForm(form(fields))).toBeNull();
    },
  );
});

describe('workspaceName (Scenario: A solo recruiter signs up with no company)', () => {
  it('is the company, or the person when there is none', () => {
    expect(workspaceName('Demo Hiring Co', 'Alex Recruiter')).toBe('Demo Hiring Co');
    expect(workspaceName('', 'Nadia Freelance')).toBe('Nadia Freelance');
  });
});

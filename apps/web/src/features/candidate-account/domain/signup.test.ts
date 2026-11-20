import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { describe, expect, it } from 'vitest';
import { CATALOGUE_V1 } from '@/test/catalogue-v1.ts';
import { parseSignUpForm, signUpHref, signUpNext, signUpStep } from './signup.ts';

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe('signUpStep', () => {
  it('shows the sign-up panel when signed out', () => {
    expect(signUpStep(null, null)).toBe('signedOut');
  });

  it('asks for full name and work type until the account has both', () => {
    expect(signUpStep('u1', null)).toBe('profile');
    expect(signUpStep('u1', { fullName: null, workType: null })).toBe('profile');
    expect(signUpStep('u1', { fullName: 'Layla Haddad', workType: null })).toBe('profile');
  });

  // Scenario: Someone who already has a candidate account.
  it('sends a signed-up candidate to My applications', () => {
    expect(signUpStep('u1', { fullName: 'Layla Haddad', workType: 'ai_llm_engineering' })).toBe('done');
  });
});

describe('parseSignUpForm', () => {
  it('accepts a full name (trimmed) and one of the published job types, and reads nothing else', () => {
    expect(
      parseSignUpForm(
        form({ fullName: '  Layla Haddad ', workType: 'ai_llm_engineering', userId: 'someone-else' }),
        CATALOGUE_V1,
      ),
    ).toEqual({ input: { fullName: 'Layla Haddad', workType: 'ai_llm_engineering' } });
    for (const { key: workType } of CATALOGUE_V1.jobTypes)
      expect(parseSignUpForm(form({ fullName: 'Layla Haddad', workType }), CATALOGUE_V1)).toHaveProperty('input');
  });

  // Scenario: Full name is required.
  it('refuses a blank full name and a missing or unknown work type, keeping what was typed', async () => {
    const t = await getTranslations(defaultLocale, defaultTimeZone);
    const refused = parseSignUpForm(form({ fullName: '   ', workType: 'astronaut' }), CATALOGUE_V1);
    expect(refused).toEqual({
      errors: { fullName: 'fullNameRequired', workType: 'workTypeRequired' },
      failed: false,
      values: { fullName: '   ', workType: 'astronaut' },
    });
    expect(t('candidate.signup.errors.fullNameRequired')).toBe('Enter your full name.');
    expect(parseSignUpForm(form({ fullName: 'L'.repeat(201), workType: 'sales' }), CATALOGUE_V1)).toMatchObject({
      errors: { fullName: 'fullNameTooLong' },
    });
    expect(parseSignUpForm(new FormData(), CATALOGUE_V1)).toMatchObject({
      errors: { fullName: 'fullNameRequired', workType: 'workTypeRequired' },
    });
  });
});

describe('signUpNext and signUpHref', () => {
  const apply = '/candidates/jobs/senior-ai-engineer/apply';
  it('keeps a candidate page and round-trips it through the sign-up address', () => {
    expect(signUpNext(apply)).toBe(apply);
    expect(signUpHref(apply)).toBe('/candidates/signup?next=%2Fcandidates%2Fjobs%2Fsenior-ai-engineer%2Fapply');
    expect(signUpNext(new URL(signUpHref(apply), 'http://x').searchParams.get('next'))).toBe(apply);
  });

  // SAFETY: mutation check: returned candidateSafeNext(value) without the sign-up and sign-in check -> this test failed
  it('never returns to the recruiter app, another site, sign-up or sign-in', () => {
    for (const value of [
      '/app',
      'https://evil.example/candidates',
      '/candidates/signup',
      '/candidates/signup?next=x',
      '/candidates/sign-in',
      '/candidates/sign-in?next=%2Fcandidates%2Fme',
      null,
    ])
      expect(signUpNext(value)).toBe('/candidates/me');
    expect(signUpHref('/candidates/me')).toBe('/candidates/signup');
  });
});

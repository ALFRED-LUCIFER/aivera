import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import { JOB_TYPES } from '@aivera/jobs';
import { describe, expect, it } from 'vitest';
import { parseSignUpForm, signUpStep } from './signup.ts';

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
  it('accepts a full name (trimmed) and one of the ten job types, and reads nothing else', () => {
    expect(
      parseSignUpForm(form({ fullName: '  Layla Haddad ', workType: 'ai_llm_engineering', userId: 'someone-else' })),
    ).toEqual({ input: { fullName: 'Layla Haddad', workType: 'ai_llm_engineering' } });
    for (const workType of JOB_TYPES)
      expect(parseSignUpForm(form({ fullName: 'Layla Haddad', workType }))).toHaveProperty('input');
  });

  // Scenario: Full name is required.
  it('refuses a blank full name and a missing or unknown work type, keeping what was typed', async () => {
    const t = await getTranslations(defaultLocale, defaultTimeZone);
    const refused = parseSignUpForm(form({ fullName: '   ', workType: 'astronaut' }));
    expect(refused).toEqual({
      errors: { fullName: 'fullNameRequired', workType: 'workTypeRequired' },
      failed: false,
      values: { fullName: '   ', workType: 'astronaut' },
    });
    expect(t('candidate.signup.errors.fullNameRequired')).toBe('Enter your full name.');
    expect(parseSignUpForm(form({ fullName: 'L'.repeat(201), workType: 'sales' }))).toMatchObject({
      errors: { fullName: 'fullNameTooLong' },
    });
    expect(parseSignUpForm(new FormData())).toMatchObject({
      errors: { fullName: 'fullNameRequired', workType: 'workTypeRequired' },
    });
  });
});

import { describe, expect, it } from 'vitest';
import { IdentityError, isEmailVerified, normalizeEmail, type IdTokenIdentity } from './user.ts';

const OURS = 'https://tenant.ciamlogin.aivera.example/v2.0';
const token = (issuer: string, emailVerified: boolean | undefined): IdTokenIdentity => ({
  issuer,
  subject: 's',
  email: 'alex@example.com',
  emailVerified,
  displayName: null,
});

describe('identity domain', () => {
  it('normalises an email to its trimmed lower-case form', () => {
    expect(normalizeEmail('  Nadia@Example.COM ')).toBe('nadia@example.com');
  });

  it('an unverified-email refusal says what to do and nothing else', () => {
    const error = new IdentityError('unverified_email');
    expect(error.message).toBe('Verify your email to continue.');
    expect(error.code).toBe('unverified_email');
  });

  it.each([
    [OURS, true, true],
    [OURS, undefined, true],
    [OURS, false, false],
    ['https://other-idp.aivera.example', true, true],
    ['https://other-idp.aivera.example', undefined, false],
    ['https://other-idp.aivera.example', false, false],
  ] as const)('isEmailVerified(%s, email_verified %s) is %s', (issuer, claim, verified) => {
    expect(isEmailVerified(token(issuer, claim), OURS)).toBe(verified);
  });
});

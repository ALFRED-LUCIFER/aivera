import { describe, expect, it } from 'vitest';
import { IdentityError, normalizeEmail } from './user.ts';

describe('identity domain', () => {
  it('normalises an email to its trimmed lower-case form', () => {
    expect(normalizeEmail('  Nadia@Example.COM ')).toBe('nadia@example.com');
  });

  it('an unverified-email refusal says what to do and nothing else', () => {
    const error = new IdentityError('unverified_email');
    expect(error.message).toBe('Verify your email to continue.');
    expect(error.code).toBe('unverified_email');
  });
});

import { describe, expect, it } from 'vitest';
import { exactReason, likelyReason, nameKey } from './duplicates.ts';

// AIV-P1-018 match rules. Synthetic cast only (docs/00-product/personas.md).
const person = (displayName: string, emails: string[] = [], phones: string[] = []) => ({ displayName, emails, phones });

describe('nameKey', () => {
  it.each([
    ['Omar Al Suwaidi', 'omaralsuwaidi'],
    ['Omar Alsuwaidi', 'omaralsuwaidi'],
    ['omar al-suwaidi.', 'omaralsuwaidi'],
    ['Zoë  Müller', 'zoemuller'],
    ['هند السويدي', 'هندالسويدي'],
    ['Unnamed applicant', ''],
  ])('%s -> %s', (name, key) => expect(nameKey(name)).toBe(key));
});

describe('Scenario: Exact duplicates merge automatically', () => {
  it.each([
    [['cv_hash', 'email'], 'same_cv_file'],
    [['email'], 'same_email'],
    [['phone'], 'same_phone'],
  ] as const)('an arrival holding the other record’s %j is the same person: %s', (types, reason) =>
    expect(exactReason(types, 'Sneha Iyer', 'S. Iyer')).toBe(reason),
  );

  it('a shared GitHub login is exact only with the same name', () => {
    expect(exactReason(['github_login'], 'Sneha Iyer', 'sneha iyer')).toBe('same_name_and_github');
    expect(exactReason(['github_login'], 'Sneha Iyer', 'Priya Nair')).toBeNull();
  });
});

describe('Scenario: A likely duplicate needs a person', () => {
  it('"Omar Al Suwaidi" and "Omar Alsuwaidi" are likely the same person by name', () => {
    expect(likelyReason(person('Omar Al Suwaidi'), person('Omar Alsuwaidi'))).toBe('same_name');
  });

  it('the same email or phone on both records is likely, never exact', () => {
    expect(
      likelyReason(person('Omar Al Suwaidi', ['omar@example.com']), person('O. Suwaidi', ['omar@example.com'])),
    ).toBe('same_contact');
    expect(likelyReason(person('A', [], ['+971500000002']), person('B', [], ['+971500000002']))).toBe('same_contact');
  });

  it('different names and contact, or two people not named yet, are not duplicates', () => {
    expect(likelyReason(person('Omar Al Suwaidi'), person('Omar Haddad'))).toBeNull();
    expect(likelyReason(person('Unnamed applicant'), person('Unnamed applicant'))).toBeNull();
  });
});

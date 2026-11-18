import { describe, expect, it } from 'vitest';
import { CandidateError, normaliseIdentifier, normaliseIdentifiers, type Identifier } from './person.ts';

describe('Scenario: Identifiers are normalised', () => {
  it.each<[Identifier, string]>([
    [{ type: 'email', value: ' Sara.AlQahtani@Example.com ' }, 'sara.alqahtani@example.com'],
    [{ type: 'phone', value: '+971 50 000 0001' }, '+971500000001'],
    [{ type: 'phone', value: '00971 (50) 000-0001' }, '+971500000001'],
    [{ type: 'cv_hash', value: 'AB'.repeat(32) }, 'ab'.repeat(32)],
    [{ type: 'github_login', value: '@Sara-AQ' }, 'sara-aq'],
  ])('%j is stored as %s', (identifier, value) => {
    expect(normaliseIdentifier(identifier)).toEqual({ type: identifier.type, value });
  });

  it.each<Identifier>([
    { type: 'email', value: 'not an email' },
    { type: 'phone', value: '050 000 0001' },
    { type: 'phone', value: '+971 50 000 0001 ext 2' },
    { type: 'cv_hash', value: 'abc' },
    { type: 'github_login', value: 'bad--login' },
  ])('refuses %j without repeating the value', (identifier) => {
    const refused = () => normaliseIdentifier(identifier);
    expect(refused).toThrow(new CandidateError('invalid_identifier'));
    try {
      refused();
    } catch (error) {
      expect(String(error)).not.toContain(identifier.value);
    }
  });

  it('drops repeats that normalise to the same value and refuses an empty list', () => {
    expect(
      normaliseIdentifiers([
        { type: 'email', value: 'Sara.AlQahtani@Example.com' },
        { type: 'email', value: 'sara.alqahtani@example.com' },
      ]),
    ).toEqual([{ type: 'email', value: 'sara.alqahtani@example.com' }]);
    expect(() => normaliseIdentifiers([])).toThrow(new CandidateError('no_identifiers'));
  });
});

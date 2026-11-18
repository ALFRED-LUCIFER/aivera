import { describe, expect, it } from 'vitest';
import { AuditError, assertValidEntry, type Action, type NewEntry, type Values } from './entry.ts';

const CANDIDATE = { type: 'candidate', id: '0190d4a2-0000-7000-8000-00000000d001' };
const entry = (action: Action, extra: Partial<NewEntry> = {}): NewEntry => ({ action, subject: CANDIDATE, ...extra });
const merged = (before: Values, after: Values) => entry('candidate.merged', { before, after });

describe('the action list', () => {
  it('refuses an action that is not on the list', () => {
    expect(() => assertValidEntry(entry('score.deleted' as Action))).toThrow(new AuditError('unknown_action'));
  });
});

describe('Scenario: A note is required where a person changes an outcome', () => {
  // SAFETY: mutation check: removed the NOTE_REQUIRED check in assertValidEntry -> these tests failed (nothing thrown)
  it.each<Action>(['decision.recorded', 'score.changed'])('"%s" without a note is refused', (action) => {
    expect(() => assertValidEntry(entry(action))).toThrow('A note is required for this action');
    expect(() => assertValidEntry(entry(action, { note: '   ' }))).toThrow(new AuditError('note_required'));
    expect(() => assertValidEntry(entry(action, { note: 'Strong system design round' }))).not.toThrow();
  });

  it('other actions need no note', () => {
    expect(() => assertValidEntry(entry('rubric.approved'))).not.toThrow();
  });
});

describe('Scenario: No raw personal data in before and after', () => {
  it('ids and field names are accepted', () => {
    expect(() =>
      assertValidEntry(
        merged(
          { candidateId: CANDIDATE.id, field: 'email' },
          { candidateId: '01909999-1111-7222-8333-444444444444', mergedFrom: CANDIDATE.id, backedScore: 61 },
        ),
      ),
    ).not.toThrow();
  });

  // SAFETY: mutation check: made looksPersonal return false -> these tests failed (nothing thrown)
  it.each([
    ['an email address', { email: 'daniel.novak@example.com' }],
    ['a phone number', { phone: '+971 50 123 4567' }],
    ['a bare phone number', { phone: '0501234567' }],
  ])('%s in after is refused without repeating the value', (_, after) => {
    const write = () => assertValidEntry(merged({ candidateId: CANDIDATE.id }, after));
    expect(write).toThrow(new AuditError('personal_data'));
    expect(write).not.toThrow(Object.values(after)[0]);
  });

  it('a plain date is refused as phone-like (deliberate, see the shortcut in entry.ts)', () => {
    expect(() => assertValidEntry(merged({}, { decidedOn: '2026-11-18' }))).toThrow(new AuditError('personal_data'));
  });

  it('an email address in before is refused', () => {
    expect(() => assertValidEntry(merged({ email: 'd.novak@example.com' }, {}))).toThrow(
      new AuditError('personal_data'),
    );
  });
});

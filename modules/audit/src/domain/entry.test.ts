import { describe, expect, it } from 'vitest';
import {
  AuditError,
  assertValidEntry,
  assertValidPlatformEntry,
  PLATFORM_ACTIONS,
  platformEntryQuerySchema,
  type Action,
  type NewEntry,
  type PlatformAction,
  type Values,
} from './entry.ts';

const CANDIDATE = { type: 'candidate', id: '0190d4a2-0000-7000-8000-00000000d001' };
const entry = (action: Action, extra: Partial<NewEntry> = {}): NewEntry => ({ action, subject: CANDIDATE, ...extra });
const merged = (before: Values, after: Values) => entry('candidate.merged', { before, after });

describe('the action list', () => {
  it('refuses an action that is not on the list', () => {
    expect(() => assertValidEntry(entry('score.deleted' as Action))).toThrow(new AuditError('unknown_action'));
  });
});

describe('the platform action list (ADR-012)', () => {
  const actorId = '0190d4a2-0000-7000-8000-00000000a001';
  it('accepts ops.console_opened and refuses an action that is not on the list', () => {
    expect(() => assertValidPlatformEntry({ actorId, action: 'ops.console_opened' })).not.toThrow();
    expect(() => assertValidPlatformEntry({ actorId, action: 'rubric.approved' as PlatformAction })).toThrow(
      new AuditError('unknown_action'),
    );
  });

  // SAFETY: mutation check: removed the NOTE_REQUIRED check in assertValidPlatformEntry -> this test failed (nothing thrown)
  it('"ai_budget.changed" needs its reason and refuses contact details in its values (AIV-P2-038)', () => {
    const change = { actorId, action: 'ai_budget.changed', before: { dailyTokenBudget: 2_000_000 } } as const;
    expect(() => assertValidPlatformEntry({ ...change, note: ' ' })).toThrow(new AuditError('note_required'));
    expect(() => assertValidPlatformEntry({ ...change, note: 'Pilot cap agreed with the team' })).not.toThrow();
    expect(() =>
      assertValidPlatformEntry({ ...change, note: 'Pilot cap', after: { contact: 'pia.platform@example.com' } }),
    ).toThrow(new AuditError('personal_data'));
  });

  // AIV-P2-053: before and after hold platform values only, whichever platform action writes them.
  // SAFETY: mutation check: removed the PLATFORM_VALUE_KEYS check in assertValidPlatformEntry -> this test failed (nothing thrown)
  it.each(PLATFORM_ACTIONS)('"%s" refuses a candidate field in before or after', (action) => {
    const base = { actorId, action, note: 'Reason' } as const;
    expect(() =>
      assertValidPlatformEntry({ ...base, before: { status: 'active' }, after: { status: 'suspended' } }),
    ).not.toThrow();
    for (const values of [{ candidateId: CANDIDATE.id }, { backedScore: 61 }])
      for (const side of ['before', 'after'] as const)
        expect(() => assertValidPlatformEntry({ ...base, [side]: values })).toThrow(new AuditError('personal_data'));
  });
});

// AIV-P2-053: the console's platform log filter is validated before any query.
describe('the platform log query', () => {
  it('defaults the page size to 50 and accepts every filter', () => {
    expect(platformEntryQuerySchema.parse({})).toEqual({ pageSize: 50 });
    const filter = {
      action: 'workspace.suspended',
      actorId: '0190d4a2-0000-7000-8000-00000000a001',
      targetId: '0190d4a2-0000-7000-8000-00000000a002',
      from: new Date('2026-11-01T00:00:00Z'),
      to: new Date('2026-11-20T00:00:00Z'),
      cursor: '0190d4a2-0000-7000-8000-00000000a003',
      pageSize: 10,
    } as const;
    expect(platformEntryQuerySchema.parse(filter)).toEqual(filter);
  });

  it.each([
    ['a page size of 500', { pageSize: 500 }],
    ['a page size of 0', { pageSize: 0 }],
    ['a malformed cursor', { cursor: "x' or 1=1 --" }],
    ['an action that is not a platform action', { action: 'rubric.approved' }],
    ['an unknown key', { workspaceId: '0190d4a2-0000-7000-8000-00000000a001' }],
  ])('refuses %s', (_case, query) => {
    expect(platformEntryQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('Scenario: A note is required where a person changes an outcome', () => {
  // SAFETY: mutation check: removed the NOTE_REQUIRED check in assertValidEntry -> these tests failed (nothing thrown)
  it.each<Action>(['pack.created', 'pack.member_added'])('"%s" (AIV-P1-139) needs no note', (action) => {
    expect(() => assertValidEntry(entry(action, { after: { packId: CANDIDATE.id, position: 0 } }))).not.toThrow();
  });

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

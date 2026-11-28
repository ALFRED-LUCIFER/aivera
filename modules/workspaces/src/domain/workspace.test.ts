import { describe, expect, it } from 'vitest';
import {
  AI_DAILY_TOKEN_BUDGET,
  assertCanChangeRole,
  pickActiveWorkspace,
  usageWindow,
  type Member,
  type MemberStatus,
  type Role,
} from './workspace.ts';

const W = '0190d4a2-0000-7000-8000-000000000001';
const member = (userId: string, role: Role, status: MemberStatus = 'active'): Member => ({
  userId,
  workspaceId: W,
  role,
  status,
  title: null,
});

describe('assertCanChangeRole', () => {
  // SAFETY: mutation check: removed the actor-is-admin check -> the recruiter, hiring_owner and interviewer cases failed
  it.each<[Role, string]>([
    ['admin', 'changed'],
    ['recruiter', 'forbidden'],
    ['hiring_owner', 'forbidden'],
    ['interviewer', 'forbidden'],
  ])("a %s changing another member's role is %s", (role, result) => {
    const members = [member('boss', 'admin'), member('actor', role), member('other', 'interviewer')];
    const attempt = () => assertCanChangeRole(members, 'actor', 'other', 'recruiter');
    if (result === 'changed') expect(attempt).not.toThrow();
    else expect(attempt).toThrow(expect.objectContaining({ code: 'forbidden' }));
  });

  it('an admin who is invited or removed is not an admin yet or any more', () => {
    for (const status of ['invited', 'removed'] as const) {
      const members = [member('boss', 'admin'), member('actor', 'admin', status), member('other', 'recruiter')];
      expect(() => assertCanChangeRole(members, 'actor', 'other', 'interviewer')).toThrow('Only a workspace admin');
    }
  });

  // SAFETY: mutation check: removed the last-admin check -> this test failed (the change was allowed)
  it('the last admin cannot change their own role', () => {
    const members = [member('alex', 'admin'), member('other', 'recruiter'), member('gone', 'admin', 'removed')];
    expect(() => assertCanChangeRole(members, 'alex', 'alex', 'recruiter')).toThrow(
      'A workspace needs at least one admin',
    );
  });

  it('with two admins, one may step down; the last admin may keep the admin role', () => {
    const members = [member('alex', 'admin'), member('sam', 'admin')];
    expect(() => assertCanChangeRole(members, 'alex', 'alex', 'recruiter')).not.toThrow();
    expect(() => assertCanChangeRole([member('alex', 'admin')], 'alex', 'alex', 'admin')).not.toThrow();
  });

  it('a removed or unknown member cannot be given a role', () => {
    const members = [member('alex', 'admin'), member('gone', 'recruiter', 'removed')];
    for (const target of ['gone', 'nobody'])
      expect(() => assertCanChangeRole(members, 'alex', target, 'admin')).toThrow(
        expect.objectContaining({ code: 'not_found' }),
      );
  });
});

describe('usageWindow (AIV-P2-038)', () => {
  it('lists the 7 UTC days ending today, newest first, across a month end, with 0 for a day with no use', () => {
    const window = usageWindow('2026-12-02', 7, [
      { day: '2026-12-02', tokens: 1_500 },
      { day: '2026-11-28', tokens: 40 },
      { day: '2026-11-25', tokens: 9 }, // outside the window
    ]);
    expect(window.map((d) => d.day)).toEqual([
      '2026-12-02',
      '2026-12-01',
      '2026-11-30',
      '2026-11-29',
      '2026-11-28',
      '2026-11-27',
      '2026-11-26',
    ]);
    expect(window.map((d) => d.tokens)).toEqual([1_500, 0, 0, 0, 40, 0, 0]);
  });
});

// AIV-P2-060: the active-workspace pointer follows membership.
describe('pickActiveWorkspace', () => {
  it('keeps the pointer while the user is a member there', () => {
    expect(pickActiveWorkspace('gulf', ['own', 'gulf'])).toBe('gulf');
  });

  it('moves a pointer to a workspace they left to their oldest membership, or none', () => {
    expect(pickActiveWorkspace('gulf', ['own', 'harbour'])).toBe('own');
    expect(pickActiveWorkspace(null, ['own'])).toBe('own');
    expect(pickActiveWorkspace('gulf', [])).toBeNull();
  });
});

// AIV-P1-165 section 7 "A pilot day's allowance covers a pilot day's work". The largest charged call of each task on
// the Azure dev environment (gpt-main, input plus output tokens, the 30 days to 28 Nov 2026; a rejected attempt
// reports no count, so every call is counted twice: the first attempt and its informed second one, both charged).
// Assessing is the scoring formula: no model call.
describe("Scenario: A pilot day's allowance covers a pilot day's work", () => {
  const LARGEST = { detectDomain: 795, draftCompetencies: 2_043, parseCv: 9_003, mapToCompetency: 6_067 };
  const ATTEMPTS = 2;
  const CVS = 30;
  const jobDraft = ATTEMPTS * (LARGEST.detectDomain + LARGEST.draftCompetencies);
  const cvsReadAndMapped = CVS * ATTEMPTS * (LARGEST.parseCv + LARGEST.mapToCompetency);
  const pilotDay = jobDraft + cvsReadAndMapped;

  it('one job draft and 30 CVs read and mapped cost 909,876 tokens at the largest calls seen', () => {
    expect(jobDraft).toBe(5_676);
    expect(cvsReadAndMapped).toBe(904_200);
    expect(pilotDay).toBe(909_876);
  });

  it('the default daily allowance covers that day twice over, so no CV waits for tomorrow', () => {
    expect(AI_DAILY_TOKEN_BUDGET.default).toBeGreaterThanOrEqual(2 * pilotDay);
  });
});

import { describe, expect, it } from 'vitest';
import { assertCanChangeRole, type Member, type MemberStatus, type Role } from './workspace.ts';

const W = '0190d4a2-0000-7000-8000-000000000001';
const member = (userId: string, role: Role, status: MemberStatus = 'active'): Member => ({
  userId,
  workspaceId: W,
  role,
  status,
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

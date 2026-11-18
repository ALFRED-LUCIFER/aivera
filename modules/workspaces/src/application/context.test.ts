import { describe, expect, it } from 'vitest';
import { ForbiddenError, PERMISSIONS, type Action, type JobResource } from '../domain/permissions.ts';
import { ROLES, type Member, type Role } from '../domain/workspace.ts';
import { contextUseCases, type WorkspaceContext } from './context.ts';
import type { WorkspaceStore } from './workspaces.ts';

const W1 = '0190d4a2-0000-7000-8000-0000000000w1';
const J1: JobResource = { jobId: 'job-1' };
const J2: JobResource = { jobId: 'job-2' };

// A faked JobGrants port: every member holds a grant on job J1 only (the real lookup is tested in tests/integration).
const useCases = (member: Member | null = null) =>
  contextUseCases<null>({
    inWorkspace: (_workspaceId, work) =>
      work(
        {
          findMember: async () => member,
          listGrants: async () => [],
          setJobScope: async () => {},
        } as unknown as WorkspaceStore,
        null,
      ),
    storeFor: () => ({}) as WorkspaceStore,
    grants: { covers: async (_ctx, resource) => resource.jobId === J1.jobId },
    active: { get: async () => null, set: async () => {} },
  });

const ctx = (role: Role): WorkspaceContext<null> => ({ userId: 'u', workspaceId: W1, role, tx: null });
const attempt = (role: Role, action: Action, resource?: JobResource) =>
  useCases()
    .authorize(ctx(role), action, resource)
    .then(
      () => 'allowed',
      (error: unknown) => (error instanceof ForbiddenError ? '403' : 'threw'),
    );

// Every action × every role, on a job the member is granted, a job they are not, and no job: Y allowed, - 403.
//                      admin  recruiter hiring_owner interviewer
const MATRIX: Record<Action, [string, string, string, string]> = {
  'job.create': ['YYY', 'YYY', '---', '---'],
  'job.list': ['YYY', 'YYY', 'YYY', 'YYY'],
  'job.view': ['YYY', 'YYY', 'Y--', 'Y--'],
  'rubric.edit': ['YYY', 'YYY', '---', '---'],
  'job.publish': ['YYY', 'YYY', '---', '---'],
  'workspace.settings': ['YYY', '---', '---', '---'],
  'client.manage': ['YYY', 'YYY', '---', '---'],
  'job_access.manage': ['YYY', '---', '---', '---'],
  'job_access.view': ['YYY', 'YYY', '---', '---'],
  'member.invite': ['YYY', '---', '---', '---'],
  'rubric.approve': ['YYY', '---', 'Y--', '---'],
  'candidate.create': ['YYY', 'YYY', '---', '---'],
  'candidate.view': ['YYY', 'YYY', 'Y--', 'Y--'],
  'scorecard.submit': ['YYY', 'YYY', 'Y--', 'Y--'],
  'decision.record': ['YYY', 'YYY', 'Y--', '---'],
};

describe('authorize: the permission map', () => {
  it('the matrix lists every action in the map', () => {
    expect(Object.keys(MATRIX).toSorted()).toEqual(Object.keys(PERMISSIONS).toSorted());
  });

  // SAFETY: mutation check: treated a missing resource as allowed (`if (resource && ...)`) -> the "no job" cells failed
  it.each(
    Object.entries(MATRIX).flatMap(([action, cells]) => ROLES.map((role, i) => [action, role, cells[i]] as const)),
  )('%s as %s: granted job, other job, no job = %s', async (action, role, cells) => {
    const results = await Promise.all([J1, J2, undefined].map((r) => attempt(role, action as Action, r)));
    expect(results.map((r) => (r === 'allowed' ? 'Y' : r === '403' ? '-' : '?')).join('')).toBe(cells);
  });
});

describe('Scenario Outline: Actions are allowed by role (grant on job J1)', () => {
  it.each([
    ['recruiter', 'job.create', 'allowed'],
    ['interviewer', 'job.create', '403'],
    ['hiring_owner', 'rubric.approve', 'allowed'],
    ['recruiter', 'rubric.approve', '403'],
    ['interviewer', 'scorecard.submit', 'allowed'],
    ['hiring_owner', 'decision.record', 'allowed'],
    ['interviewer', 'decision.record', '403'],
  ] as const)('%s attempting %s on J1 is %s', async (role, action, result) => {
    expect(await attempt(role, action, J1)).toBe(result);
  });
});

describe("Scenario Outline: Job-scoped roles need a grant on the record's job", () => {
  it.each([
    ['hiring_owner', J1, 'allowed'],
    ['hiring_owner', J2, '403'],
    ['hiring_owner', undefined, '403'],
    ['interviewer', J2, '403'],
    ['recruiter', J2, 'allowed'],
    ['admin', undefined, 'allowed'],
  ] as const)('%s viewing a candidate on %o is %s', async (role, resource, result) => {
    expect(await attempt(role, 'candidate.view', resource)).toBe(result);
  });
});

describe('withWorkspace', () => {
  it.each([
    ['not a member', null],
    ['invited', { userId: 'u', workspaceId: W1, role: 'admin', status: 'invited' }],
    ['removed', { userId: 'u', workspaceId: W1, role: 'admin', status: 'removed' }],
  ] as const)('refuses a user who is %s and never runs the handler', async (_label, member) => {
    let ran = false;
    await expect(
      useCases(member).withWorkspace({ userId: 'u' }, W1, async () => {
        ran = true;
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(ran).toBe(false);
  });

  it('passes an active member their role and the scoped transaction', async () => {
    const member: Member = { userId: 'u', workspaceId: W1, role: 'interviewer', status: 'active' };
    expect(await useCases(member).withWorkspace({ userId: 'u' }, W1, async (c) => c)).toEqual(ctx('interviewer'));
  });
});

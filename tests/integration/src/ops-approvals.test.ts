import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AuditContract } from '@credalent/audit';
import { createAudit } from '@credalent/audit/composition';
import { createDb, withWorkspace, type Db } from '@credalent/db';
import type { JobsContract } from '@credalent/jobs';
import { createJobs } from '@credalent/jobs/composition';
import { OpsError, type OpsSettingsContract } from '@credalent/ops';
import { createOpsSettings } from '@credalent/ops/composition';
import {
  WorkspaceError,
  WorkspacePausedError,
  type WorkspaceDirectory,
  type WorkspaceContext,
  type WorkspacesContract,
} from '@credalent/workspaces';
import { createWorkspaceDirectory, createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P2-039 (ADR-012 points 7 to 9): new workspaces wait for approval while the pilot runs, against real PostgreSQL
// as the non-owner aivera_app role under the unchanged tenant policies. Synthetic cast only (personas.md).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');
const user = (n: number) => `0190d4a2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const NADIA = user(1);
const ALEX = user(2);
const RAMI = user(3);
const LATE = user(4);
const PIA = user(9);
const THEO = user(10);
const NOW = new Date('2026-11-19T09:00:00.000Z');

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let audit: AuditContract;
let workspaces: WorkspacesContract;
let directory: WorkspaceDirectory;
let jobs: JobsContract;
let settings: OpsSettingsContract;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

/** Sign-up as the web action does it: the switch decides whether the new workspace waits. */
const signUp = async (name: string, creatorUserId: string) =>
  (
    await workspaces.createWorkspace({
      name,
      company: name,
      hiringFocus: 'several',
      creatorUserId,
      needsApproval: await settings.approvalRequired(),
    })
  ).id;
const statusOf = async (id: string) =>
  (await admin.execute<{ status: string }>(sql`select status from workspaces.workspace where id = ${id}`))[0]?.status;
const addJob = (userId: string, workspaceId: string) =>
  workspaces.withWorkspace({ userId }, workspaceId, (ctx: WorkspaceContext) =>
    jobs.createJob(ctx, {
      title: 'Staff Backend Engineer',
      jobType: 'software_engineering',
      description: 'x',
      synthetic: true,
    }),
  );
const platformLog = () =>
  admin.execute<{ action: string; actor_id: string; note: string | null; before: unknown; after: unknown }>(
    sql`select action, actor_id, note, before, after from audit.platform_entry order by occurred_at, action`,
  );

let demo: string;
let gulf: string;
let nadia: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 2 });
  audit = createAudit(app, () => NOW);
  workspaces = createWorkspaces(app, audit);
  directory = createWorkspaceDirectory(app);
  jobs = createJobs(workspaces, audit, () => NOW);
  settings = createOpsSettings(app, audit);
  // An existing (seeded) workspace: created without needsApproval, as tools/seed and the e2e seed do.
  demo = (
    await workspaces.createWorkspace({
      name: 'Demo Hiring Co',
      company: 'Demo Hiring Co',
      hiringFocus: 'several',
      synthetic: true,
      creatorUserId: ALEX,
    })
  ).id;
  gulf = (
    await workspaces.createWorkspace({
      name: 'Gulf Talent Partners',
      company: 'Gulf Talent Partners',
      hiringFocus: 'several',
      synthetic: true,
      creatorUserId: user(7),
    })
  ).id;
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

describe('Feature: Approve new workspaces during the pilot', () => {
  it('the switch is on after migrating, from the seeded settings row', async () => {
    expect(await settings.approvalRequired()).toBe(true);
  });

  // SAFETY: mutation check: let 'pending_approval' pass allowedWhile in the request context -> this test failed
  it('Scenario: A sign-up waits for approval: pending_approval, and adding a job is refused', async () => {
    nadia = await signUp('Nadia Freelance', NADIA);
    expect(await statusOf(nadia)).toBe('pending_approval');
    await expect(addJob(NADIA, nadia)).rejects.toBeInstanceOf(WorkspacePausedError);
    expect(await admin.execute(sql`select 1 from jobs.job where workspace_id = ${nadia}`)).toHaveLength(0);
  });

  it('Scenario: The operator approves: listed with its creator, then active, audited, and a job can be added', async () => {
    const [listed] = await directory.listPending();
    expect(listed).toMatchObject({
      summary: { id: nadia, name: 'Nadia Freelance', type: 'in_house' },
      creatorUserId: NADIA,
    });
    await workspaces.changeStatus({ operatorId: PIA, workspaceId: nadia, change: 'approve', reason: '' });
    expect(await statusOf(nadia)).toBe('active');
    expect((await audit.listOperatorEntries(nadia)).map((e) => [e.action, e.actor])).toEqual([
      ['workspace.approved', { type: 'operator', id: PIA }],
    ]);
    expect((await platformLog()).map((e) => [e.action, e.actor_id])).toEqual([['workspace.approved', PIA]]);
    await addJob(NADIA, nadia);
  });

  it('Scenario: The operator rejects with a reason: rejected, the reason in both logs, and no new work', async () => {
    const turnedAway = await signUp('Turned Away Recruiting', LATE);
    await expect(
      workspaces.changeStatus({ operatorId: PIA, workspaceId: turnedAway, change: 'reject', reason: 'too short' }),
    ).rejects.toEqual(new WorkspaceError('reason_required'));
    await workspaces.changeStatus({
      operatorId: PIA,
      workspaceId: turnedAway,
      change: 'reject',
      reason: "Outside the pilot's agreed teams",
    });
    expect(await statusOf(turnedAway)).toBe('rejected');
    const [entry] = await audit.listOperatorEntries(turnedAway);
    expect(entry).toMatchObject({ action: 'workspace.rejected', note: "Outside the pilot's agreed teams" });
    expect((await platformLog()).at(-1)).toMatchObject({
      action: 'workspace.rejected',
      note: "Outside the pilot's agreed teams",
    });
    await expect(addJob(LATE, turnedAway)).rejects.toBeInstanceOf(WorkspacePausedError);
    // Only pending workspaces are decided: approving a rejected one is a conflict.
    await expect(
      workspaces.changeStatus({ operatorId: PIA, workspaceId: turnedAway, change: 'approve', reason: '' }),
    ).rejects.toEqual(new WorkspaceError('status_conflict'));
  });

  it('Scenario: Changing the switch is audited and approves nothing', async () => {
    const waiting = await signUp('Still Waiting Co', user(5));
    await settings.setApprovalRequired({ operatorId: THEO, required: false, reason: 'Pilot open to all' });
    expect(await settings.approvalRequired()).toBe(false);
    expect((await platformLog()).find((e) => e.action === 'ops.approval_mode_changed')).toEqual({
      action: 'ops.approval_mode_changed',
      actor_id: THEO,
      note: 'Pilot open to all',
      before: { approvalRequired: true },
      after: { approvalRequired: false },
    });
    expect(await statusOf(waiting)).toBe('pending_approval');
    expect(await statusOf(await signUp('Open Sign-up Co', user(6)))).toBe('active');
    await expect(
      settings.setApprovalRequired({ operatorId: THEO, required: false, reason: 'Pilot open to all' }),
    ).rejects.toEqual(new OpsError('unchanged'));
  });

  it('Scenario: Existing and seeded workspaces are unaffected, and joining one asks for no approval', async () => {
    await settings.setApprovalRequired({ operatorId: PIA, required: true, reason: 'Pilot needs approval again' });
    expect([await statusOf(demo), await statusOf(gulf)]).toEqual(['active', 'active']);
    // Rami joins Demo Hiring Co (invitations are AIV-P1-003; a membership row is what accepting one writes).
    await withWorkspace(app, demo, (tx) =>
      tx.execute(sql`insert into workspaces.member (workspace_id, user_id, role, status)
        values (${demo}, ${RAMI}, 'interviewer', 'active')`),
    );
    expect(await statusOf(demo)).toBe('active');
    expect(await workspaces.getMembership(RAMI, demo)).toMatchObject({ role: 'interviewer' });
  });
});

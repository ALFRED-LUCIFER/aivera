import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AuditContract } from '@credalent/audit';
import { createAudit } from '@credalent/audit/composition';
import type { CandidatesContract } from '@credalent/candidates';
import { createCandidates } from '@credalent/candidates/composition';
import { createDb, type Db } from '@credalent/db';
import type { Competency, JobsContract, PublicJobsContract } from '@credalent/jobs';
import { createJobs, createPublicJobs } from '@credalent/jobs/composition';
import {
  WorkspaceError,
  WorkspacePausedError,
  type StatusChange,
  type WorkspaceContext,
  type WorkspacesContract,
} from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P2-037 (ADR-012 points 6 to 8): an operator suspends and reactivates a workspace, against real PostgreSQL as the
// non-owner aivera_app role under the unchanged tenant policies. Synthetic cast only (personas.md).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');
const OMAR = '0190d4a2-0000-7000-8000-00000000a0a1'; // admin of Gulf Talent Partners
const PIA = '0190d4a2-0000-7000-8000-00000000a0f1'; // operator
const NOW = new Date('2026-11-19T09:00:00.000Z');

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let audit: AuditContract;
let workspaces: WorkspacesContract;
let jobs: JobsContract;
let candidates: CandidatesContract;
let publicJobs: PublicJobsContract;
let gulf: string;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
const asOmar = <T>(fn: (ctx: WorkspaceContext) => Promise<T>) => workspaces.withWorkspace({ userId: OMAR }, gulf, fn);
/** As the console does it (server/operator.ts): the status and the public listings in one transaction. */
const change = (to: StatusChange, reason: string, contract = workspaces) =>
  contract.changeStatus({ operatorId: PIA, workspaceId: gulf, change: to, reason }, (tx) =>
    jobs.pausePublicListings(tx, gulf, to === 'suspend'),
  );
const status = async () =>
  (await admin.execute<{ status: string }>(sql`select status from workspaces.workspace where id = ${gulf}`))[0]?.status;
/** Read as the superuser: aivera_app may only insert into the platform log. */
const platformLog = () =>
  admin.execute<{ action: string; actor_id: string; subject_id: string; note: string }>(
    sql`select action, actor_id, subject_id, note from audit.platform_entry order by occurred_at, action`,
  );
const operatorEntries = () => audit.listOperatorEntries(gulf);
const ranking = () =>
  asOmar(async (ctx) => ({
    jobs: (await jobs.listJobs(ctx)).map((j) => [j.id, j.title, j.stage]),
    people: (await candidates.listPeople(ctx)).map((p) => [p.id, p.displayName]),
  }));

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
  jobs = createJobs(workspaces, audit, () => NOW);
  candidates = createCandidates(workspaces, () => NOW);
  publicJobs = createPublicJobs(app);
  gulf = (
    await workspaces.createWorkspace({
      name: 'Gulf Talent Partners',
      company: 'Gulf Talent Partners',
      hiringFocus: 'several',
      synthetic: true,
      creatorUserId: OMAR,
    })
  ).id;
  // A published job and two candidates, so suspension has something it could wrongly hide or reorder.
  const competencies: Competency[] = [
    { name: 'Delivery', evidenceExpected: 'A repository', weightPercent: 100, levelNeeded: 3 },
  ].map((c) => ({ ...c, type: 'mandatory', origin: 'from_description' }));
  await asOmar(async (ctx) => {
    const job = await jobs.createJob(ctx, {
      title: 'Staff Backend Engineer',
      jobType: 'software_engineering',
      description: 'Staff Backend Engineer, synthetic.',
      synthetic: true,
    });
    const version = await jobs.saveRubric(ctx, job.id, { successStatement: 'Ships.', competencies });
    await jobs.submitRubric(ctx, version.id);
    await jobs.approveRubric(ctx, version.id);
    await jobs.publishJob(ctx, job.id, { publicDescriptor: 'A payments scale-up' });
    for (const [displayName, email] of [
      ['Tarek Mansour', 'tarek@example.com'],
      ['Sara Al Qahtani', 'sara@example.com'],
    ] as const)
      await candidates.findOrCreatePerson(ctx, {
        displayName,
        identifiers: [{ type: 'email', value: email }],
        synthetic: true,
      });
  });
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

describe('Feature: Suspend and reactivate a workspace', () => {
  it('the status check constraint refuses any other status', async () => {
    await expect(
      admin.execute(sql`update workspaces.workspace set status = 'paused' where id = ${gulf}`),
    ).rejects.toMatchObject({ constraint: 'workspace_status_check' });
    expect(await status()).toBe('active');
  });

  it('refuses a reason under 10 characters and changes nothing', async () => {
    await expect(change('suspend', 'too short')).rejects.toEqual(new WorkspaceError('reason_required'));
    expect(await status()).toBe('active');
  });

  // SAFETY: mutation check: wrote store.operatorAudit in its own inWorkspace transaction after the change -> this test failed
  it("the audit writes share the change's transaction: a failed platform write leaves the status unchanged", async () => {
    const failing = createWorkspaces(app, {
      ...audit,
      recordPlatform: () => Promise.reject(new Error('platform log unavailable')),
    });
    await expect(change('suspend', 'Pilot ended on 30 Nov 2026', failing)).rejects.toThrow('platform log unavailable');
    expect(await status()).toBe('active');
    expect(await operatorEntries()).toEqual([]);
    expect(await publicJobs.listPublicJobs()).toHaveLength(1);
  });

  let before: Awaited<ReturnType<typeof ranking>>;

  it('Scenario: A suspension is applied and audited, in both logs, as the operator', async () => {
    before = await ranking();
    await change('suspend', 'Pilot ended on 30 Nov 2026');
    expect(await status()).toBe('suspended');
    expect(await operatorEntries()).toEqual([
      expect.objectContaining({
        action: 'workspace.suspended',
        actor: { type: 'operator', id: PIA },
        occurredAt: NOW,
        note: 'Pilot ended on 30 Nov 2026',
        before: { status: 'active' },
        after: { status: 'suspended' },
      }),
    ]);
    expect(await platformLog()).toEqual([
      { action: 'workspace.suspended', actor_id: PIA, subject_id: gulf, note: 'Pilot ended on 30 Nov 2026' },
    ]);
    const [values] = await admin.execute<{ before: unknown; after: unknown }>(
      sql`select before, after from audit.platform_entry where action = 'workspace.suspended'`,
    );
    expect(values).toEqual({ before: { status: 'active' }, after: { status: 'suspended' } });
  });

  it('a second suspend is a conflict and records nothing', async () => {
    await expect(change('suspend', 'Pilot ended on 30 Nov 2026')).rejects.toEqual(
      new WorkspaceError('status_conflict'),
    );
    expect(await platformLog()).toHaveLength(1);
  });

  // SAFETY: mutation check: removed the allowedWhile check from authorize (the request context) -> this test failed
  it('Scenario: Members of a suspended workspace can read but not start work', async () => {
    expect((await ranking()).jobs).toHaveLength(1);
    await expect(
      asOmar((ctx) =>
        jobs.createJob(ctx, {
          title: 'Another job',
          jobType: 'software_engineering',
          description: 'x',
          synthetic: true,
        }),
      ),
    ).rejects.toBeInstanceOf(WorkspacePausedError);
    // Nothing was written: still the one job, and no job.created entry beyond the first.
    expect((await ranking()).jobs).toHaveLength(1);
  });

  it("hides the workspace's public jobs from the candidate site while suspended", async () => {
    expect(await publicJobs.listPublicJobs()).toEqual([]);
    const [{ slug } = { slug: '' }] = await admin.execute<{ slug: string }>(
      sql`select slug from jobs.public_job where workspace_id = ${gulf}`,
    );
    expect(await publicJobs.findPublicJob(slug)).toEqual({ open: false });
  });

  it('Scenario: Reactivating: active again, members can start work, both logs record workspace.reactivated', async () => {
    await change('reactivate', 'Pilot extended to 31 Dec 2026');
    expect(await status()).toBe('active');
    expect((await operatorEntries()).map((e) => [e.action, e.note])).toEqual([
      ['workspace.suspended', 'Pilot ended on 30 Nov 2026'],
      ['workspace.reactivated', 'Pilot extended to 31 Dec 2026'],
    ]);
    expect((await platformLog()).map((e) => e.action)).toEqual(['workspace.reactivated', 'workspace.suspended']);
    expect((await publicJobs.listPublicJobs()).map((j) => j.title)).toEqual(['Staff Backend Engineer']);
  });

  it('Scenario: Suspension keeps every candidate and the order: the same jobs and people, in the same order', async () => {
    expect(await ranking()).toEqual(before);
  });

  it('after reactivating, members can start work again', async () => {
    await asOmar((ctx) =>
      jobs.createJob(ctx, { title: 'Another job', jobType: 'software_engineering', description: 'x', synthetic: true }),
    );
  });
});

/** Sessions of the app role waiting on a lock right now. */
const lockWaits = async () =>
  Number(
    (
      await admin.execute<{ n: string }>(
        sql`select count(*) as n from pg_stat_activity where usename = 'aivera_app' and wait_event_type = 'Lock'`,
      )
    )[0]?.n,
  );

const untilWaiting = async (what: string) => {
  for (let i = 0; (await lockWaits()) === 0; i++) {
    if (i > 200) throw new Error(`${what} never waited on the lock`);
    await sleep(25);
  }
};

describe('row locks: a status change and the work in flight', () => {
  let other: Db;
  let otherWorkspaces: WorkspacesContract;
  beforeAll(() => {
    other = createDb(urlFor('aivera_app'), { max: 2 });
    otherWorkspaces = createWorkspaces(other, audit);
  });
  afterAll(() => other?.$client.end());

  // SAFETY: mutation check: read the status with findWorkspace (no lock) in withWorkspace -> this test failed (no wait)
  it('a suspension waits for a request already running in the workspace, then applies', async () => {
    let suspension: Promise<void> | undefined;
    await otherWorkspaces.withWorkspace({ userId: OMAR }, gulf, async (ctx) => {
      expect(ctx.status).toBe('active');
      suspension = change('suspend', 'Lock check: pilot paused');
      await untilWaiting('the suspension');
      expect(await status()).toBe('active');
    });
    await suspension;
    expect(await status()).toBe('suspended');
    await change('reactivate', 'Lock check: pilot resumed');
  });

  // SAFETY: mutation check: lockWorkspace back to .for('update') -> this test failed (deadlock detected, one refused)
  it('two member requests that lock the workspace row do not deadlock', async () => {
    let enterSecond!: () => void;
    const secondInside = new Promise<void>((resolve) => (enterSecond = resolve));
    let releaseSecond!: () => void;
    const go = new Promise<void>((resolve) => (releaseSecond = resolve));
    const second = otherWorkspaces.withWorkspace({ userId: OMAR }, gulf, async (ctx) => {
      enterSecond();
      await go;
      await otherWorkspaces.setWorkspaceType(ctx, 'in_house');
    });
    // Both contexts now hold KEY SHARE on the row; then both take the row lock for a type change.
    await asOmar(async (ctx) => {
      await secondInside;
      releaseSecond();
      // With FOR UPDATE, each request's lock would wait on the other's KEY SHARE: a deadlock, whichever goes first.
      await workspaces.setWorkspaceType(ctx, 'in_house');
    });
    await expect(second).resolves.toBeUndefined();
  });
});

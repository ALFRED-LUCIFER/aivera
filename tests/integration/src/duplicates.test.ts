import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createAudit } from '@credalent/audit/composition';
import { CandidateError, type CandidatesContract } from '@credalent/candidates';
import { createCandidates, displayNamesInWorkspace } from '@credalent/candidates/composition';
import { createDb, withWorkspace, type Db } from '@credalent/db';
import type { EvidenceContract } from '@credalent/evidence';
import { createEvidence, createEvidenceRecords } from '@credalent/evidence/composition';
import type { IntakeContract, Source } from '@credalent/intake';
import { applicationRecords, createIntake } from '@credalent/intake/composition';
import type { JobsContract } from '@credalent/jobs';
import { createJobs } from '@credalent/jobs/composition';
import { ForbiddenError, type WorkspaceContext, type WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P1-018 acceptance scenarios against real PostgreSQL, connected as the non-owner aivera_app role (ADR-004, ADR-005).
// Synthetic cast only (docs/00-product/personas.md).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1'; // creates the workspaces: admin
const MARIA = '0190d4a2-0000-7000-8000-0000000011cc'; // recruiter
const LINA = '0190d4a2-0000-7000-8000-0000000011aa'; // interviewer
const NOW = new Date('2026-11-20T09:00:00.000Z');
const DAY = 86_400_000;
const cvHash = (n: number) => n.toString(16).padStart(64, '0');

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let workspaces: WorkspacesContract;
let jobs: JobsContract;
let candidates: CandidatesContract;
let intake: IntakeContract;
let evidence: EvidenceContract;
let w1: string;
let w2: string;
let clock = NOW;
const now = () => clock;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const as = <T>(userId: string, workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId }, workspaceId, fn);

const newJob = (title: string) =>
  as(
    ALEX,
    w1,
    async (ctx) =>
      (await jobs.createJob(ctx, { title, jobType: 'ai_llm_engineering', description: `${title}.`, synthetic: true }))
        .id,
  );

const arrive = (
  jobId: string,
  displayName: string,
  source: Source,
  identifiers: { email?: string; cv?: number },
  workspaceId = w1,
) =>
  as(ALEX, workspaceId, (ctx) =>
    intake.receiveApplication(ctx, {
      jobId,
      person: {
        displayName,
        identifiers: [
          ...(identifiers.email ? [{ type: 'email' as const, value: identifiers.email }] : []),
          ...(identifiers.cv ? [{ type: 'cv_hash' as const, value: cvHash(identifiers.cv) }] : []),
        ],
        synthetic: true,
      },
      source,
      fileIds: [crypto.randomUUID()],
    }),
  );

const repository = (candidateId: string, name: string) =>
  as(ALEX, w1, (ctx) =>
    evidence.recordEvidence(ctx, {
      candidateId,
      source: {
        kind: 'repository',
        label: name,
        url: `https://code.credalent.example/${name}`,
        blobFileId: null,
        capturedAt: NOW,
        checkedAt: NOW,
        checkMethod: 'Commit history',
      },
      items: [
        {
          excerpt: 'authored 212 of 240 commits',
          excerptSpan: null,
          provenance: 'corroborated',
          strength: 'strong',
          limit: 'Shows the code, not its use in production.',
          competencies: [],
        },
      ],
      synthetic: true,
    }),
  );

const rows = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>, workspaceId = w1) =>
  withWorkspace(app, workspaceId, async (tx) => [...(await tx.execute<T>(query))]);

/** Each application of the person: its job and its sources' channels, as the database holds them. */
const applicationsOf = (personId: string) =>
  rows<{ id: string; job_id: string; sources: string[] }>(sql`
    select a.id, a.job_id, array_agg(s.source order by s.received_at, s.id) as sources
    from intake.application a join intake.application_source s on s.application_id = a.id
    where a.person_id = ${personId} group by a.id, a.job_id order by a.id`);

const sourcesOf = async (personId: string) =>
  (await rows<{ id: string }>(sql`select id from evidence.source where candidate_id = ${personId} order by id`)).map(
    (r) => r.id,
  );

const auditFor = async (personId: string) =>
  (
    await rows<{ action: string; actor_type: string; actor_id: string | null; note: string; occurred_at: string }>(sql`
      select action, actor_type, actor_id, note, occurred_at from audit.entry
      where subject_type = 'candidate' and subject_id = ${personId} and action like 'candidate.%merged'
      order by occurred_at, id`)
  ).map((r) => ({ ...r, occurred_at: new Date(r.occurred_at) }));

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 1 });
  const audit = createAudit(app, now);
  workspaces = createWorkspaces(app, audit);
  jobs = createJobs(workspaces, audit, now);
  candidates = createCandidates(workspaces, now, {
    audit,
    applications: applicationRecords,
    evidence: createEvidenceRecords(now),
  });
  intake = createIntake(workspaces, candidates, jobs, displayNamesInWorkspace, now);
  evidence = createEvidence(workspaces, audit, now);
  const newWorkspace = async (name: string) =>
    (await workspaces.createWorkspace({ name, company: name, hiringFocus: 'AI', synthetic: true, creatorUserId: ALEX }))
      .id;
  w1 = await newWorkspace('Demo Hiring Co');
  w2 = await newWorkspace('Gulf Talent Partners');
  await withWorkspace(app, w1, (tx) =>
    tx.execute(
      sql`insert into workspaces.member (workspace_id, user_id, role, status) values (${w1}, ${LINA}, 'interviewer', 'active'),
        (${w1}, ${MARIA}, 'recruiter', 'active')`,
    ),
  );
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

describe('Scenario: Exact duplicates merge automatically', () => {
  let job: string;
  let linkedin: Awaited<ReturnType<typeof arrive>>;
  let email: Awaited<ReturnType<typeof arrive>>;
  let sourceId: string;

  it('Sneha via LinkedIn and via Email with the same CV file is one person with both sources, audited as the system', async () => {
    clock = NOW;
    job = await newJob('Senior AI Engineer');
    // Two arrivals with nothing in common make two people; a third carrying her email and that CV file proves it.
    linkedin = await arrive(job, 'Sneha Iyer', 'linkedin', { email: 'sneha.iyer@example.com' });
    email = await arrive(job, 'Sneha Iyer', 'email', { cv: 1 });
    expect(email.personId).not.toBe(linkedin.personId);
    ({ sourceId } = await repository(email.personId, 'sneha-rag'));

    const proof = await arrive(job, 'Sneha Iyer', 'email', { email: 'sneha.iyer@example.com', cv: 1 });

    expect(proof.personId).toBe(linkedin.personId);
    const people = await as(ALEX, w1, (ctx) => candidates.listPeople(ctx));
    expect(people.filter((p) => p.displayName === 'Sneha Iyer').map((p) => p.id)).toEqual([linkedin.personId]);
    // Both applied to the same job: one application, holding every source.
    expect(await applicationsOf(linkedin.personId)).toEqual([
      { id: linkedin.applicationId, job_id: job, sources: ['linkedin', 'email', 'email'] },
    ]);
    expect(await sourcesOf(linkedin.personId)).toEqual([sourceId]);
    // Her emptied application is kept for the undo, but is no longer an application of the job.
    const listed = await as(ALEX, w1, (ctx) => intake.listApplicationsForJob(ctx, job));
    expect(listed.map((a) => [a.applicationId, a.personId])).toEqual([[linkedin.applicationId, linkedin.personId]]);
    const [report] = await as(ALEX, w1, (ctx) => candidates.detectDuplicates(ctx, [linkedin.personId]));
    expect(report?.merged).toMatchObject([{ displayName: 'Sneha Iyer', automatic: true, undoable: true }]);
    expect(await auditFor(email.personId)).toMatchObject([
      { action: 'candidate.merged', actor_type: 'system', actor_id: null, note: 'merged automatically: same CV file' },
    ]);
    // The survivor is assessed again with the merged evidence.
    expect(
      await rows(sql`select 1 from evidence.outbox where type = 'EvidenceRecorded.v1'
        and payload->>'candidateId' = ${linkedin.personId} and dedupe_key like 'merge:%'`),
    ).toHaveLength(1);
  });

  // SAFETY: mutation check: skipped evidence.restore in unmergePeople (application/merge.ts) -> this test failed (the repository stayed with the survivor)
  it('undoing it gives the emptied application its sources back; the arrival that proved it stays with the survivor', async () => {
    const [report] = await as(ALEX, w1, (ctx) => candidates.detectDuplicates(ctx, [linkedin.personId]));
    const mergeId = report?.merged[0]?.mergeId ?? '';
    await as(ALEX, w1, (ctx) => candidates.unmergePeople(ctx, mergeId, 'Two different people'));
    expect(await applicationsOf(email.personId)).toEqual([
      { id: email.applicationId, job_id: job, sources: ['email'] },
    ]);
    // The proof arrived after the merge, as the survivor: it is not one of the sources the merge moved.
    expect(await applicationsOf(linkedin.personId)).toEqual([
      { id: linkedin.applicationId, job_id: job, sources: ['linkedin', 'email'] },
    ]);
    expect(await sourcesOf(email.personId)).toEqual([sourceId]);
    expect(await sourcesOf(linkedin.personId)).toEqual([]);
    const listed = await as(ALEX, w1, (ctx) => intake.listApplicationsForJob(ctx, job));
    expect(listed.map((a) => a.applicationId).toSorted()).toEqual(
      [linkedin.applicationId, email.applicationId].toSorted(),
    );
  });
});

describe('Scenario: A likely duplicate needs a person', () => {
  it('"Omar Alsuwaidi" shows "Possible duplicate of Omar Al Suwaidi"; nothing is merged', async () => {
    const job = await newJob('Staff Backend Engineer');
    const first = await arrive(job, 'Omar Al Suwaidi', 'linkedin', { cv: 11 });
    const second = await arrive(job, 'Omar Alsuwaidi', 'email', { cv: 12 });
    const reports = await as(MARIA, w1, (ctx) => candidates.detectDuplicates(ctx, [first.personId, second.personId]));
    expect(reports).toEqual([
      { personId: first.personId, possible: [], merged: [] },
      {
        personId: second.personId,
        possible: [{ personId: first.personId, displayName: 'Omar Al Suwaidi', reason: 'same_name' }],
        merged: [],
      },
    ]);
    const people = await as(ALEX, w1, (ctx) => candidates.listPeople(ctx));
    expect(people.map((p) => p.id)).toEqual(expect.arrayContaining([first.personId, second.personId]));
  });
});

describe('Scenario: Merge preview, confirm and undo', () => {
  let job: string;
  let other: string;
  let layla: Awaited<ReturnType<typeof arrive>>;
  let dup: Awaited<ReturnType<typeof arrive>>;
  let laylaSources: string[];
  let dupSources: string[];
  let mergeId: string;

  beforeAll(async () => {
    clock = NOW;
    job = await newJob('QA Automation Engineer');
    other = await newJob('Senior Product Manager, Payments');
    layla = await arrive(job, 'Layla Haddad', 'referral', { cv: 21 });
    dup = await arrive(other, 'Layla  Haddad', 'whatsapp', { cv: 22 });
    laylaSources = [(await repository(layla.personId, 'layla-tests')).sourceId];
    dupSources = [(await repository(dup.personId, 'layla-checkout')).sourceId];
    // The same link on both: the duplicate's read of it stays with her, as the survivor already holds that link.
    for (const candidateId of [layla.personId, dup.personId])
      await as(ALEX, w1, (ctx) =>
        evidence.requestLinkRead(ctx, {
          candidateId,
          url: 'https://shop.credalent.example/essay',
          label: 'Write-up',
          synthetic: true,
        }),
      );
  });

  it('the preview lists which applications, at which stage, sources and evidence combine; nothing changes until confirmed', async () => {
    const preview = await as(MARIA, w1, (ctx) => candidates.previewMerge(ctx, layla.personId, dup.personId));
    expect(preview).toEqual({
      survivor: {
        personId: layla.personId,
        displayName: 'Layla Haddad',
        applications: [{ jobId: job, stage: 'new', sources: ['referral'] }],
        evidenceSources: 2,
      },
      merged: {
        personId: dup.personId,
        displayName: 'Layla  Haddad',
        applications: [{ jobId: other, stage: 'new', sources: ['whatsapp'] }],
        evidenceSources: 2,
      },
    });
    expect((await as(ALEX, w1, (ctx) => candidates.getPerson(ctx, dup.personId)))?.mergedIntoId).toBeNull();
  });

  // SAFETY: mutation check: skipped evidence.move in merge (application/merge.ts) -> this test failed (the source stayed with the duplicate)
  it('confirming moves the applications and evidence, keeps the duplicate as merged, and records who, when and why', async () => {
    clock = NOW;
    ({ mergeId } = await as(MARIA, w1, (ctx) =>
      candidates.mergePeople(ctx, layla.personId, dup.personId, 'Same person, two CVs'),
    ));
    expect((await as(ALEX, w1, (ctx) => candidates.getPerson(ctx, dup.personId)))?.mergedIntoId).toBe(layla.personId);
    expect((await applicationsOf(layla.personId)).map((a) => a.id).toSorted()).toEqual(
      [layla.applicationId, dup.applicationId].toSorted(),
    );
    // Her repository and link, and the duplicate's repository.
    expect(await sourcesOf(layla.personId)).toEqual(expect.arrayContaining([...laylaSources, ...dupSources]));
    expect(await sourcesOf(layla.personId)).toHaveLength(3);
    // The duplicate's items follow their source (ON UPDATE CASCADE).
    expect(
      await rows(
        sql`select 1 from evidence.item where source_id = ${dupSources[0] ?? ''} and candidate_id = ${layla.personId}`,
      ),
    ).toHaveLength(1);
    // Her read of the link both sent stays with her; nothing is deleted.
    expect(await sourcesOf(dup.personId)).toHaveLength(1);
    expect(await auditFor(dup.personId)).toEqual([
      {
        action: 'candidate.merged',
        actor_type: 'user',
        actor_id: MARIA,
        note: 'Same person, two CVs',
        occurred_at: NOW,
      },
    ]);
    // Merging her again, or into someone merged, is refused.
    await expect(
      as(MARIA, w1, (ctx) => candidates.mergePeople(ctx, layla.personId, dup.personId, 'again')),
    ).rejects.toThrow(CandidateError);
  });

  it('a recruiter cannot undo a merge; an admin can, within the undo window', async () => {
    clock = new Date(NOW.getTime() + 3 * DAY);
    await expect(as(MARIA, w1, (ctx) => candidates.unmergePeople(ctx, mergeId, 'Wrong person'))).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('Scenario: Undo a merge made 3 days ago restores both people and their original applications, audited', async () => {
    clock = new Date(NOW.getTime() + 3 * DAY);
    const before = await sourcesOf(layla.personId);
    await as(ALEX, w1, (ctx) => candidates.unmergePeople(ctx, mergeId, 'Two different people'));
    expect((await as(ALEX, w1, (ctx) => candidates.getPerson(ctx, dup.personId)))?.mergedIntoId).toBeNull();
    expect(await applicationsOf(layla.personId)).toEqual([
      { id: layla.applicationId, job_id: job, sources: ['referral'] },
    ]);
    expect(await applicationsOf(dup.personId)).toEqual([
      { id: dup.applicationId, job_id: other, sources: ['whatsapp'] },
    ]);
    expect(await sourcesOf(layla.personId)).toEqual(before.filter((s) => !dupSources.includes(s)));
    expect(await sourcesOf(dup.personId)).toEqual(expect.arrayContaining(dupSources));
    expect(await sourcesOf(dup.personId)).toHaveLength(2);
    expect((await auditFor(dup.personId)).at(-1)).toEqual({
      action: 'candidate.unmerged',
      actor_type: 'user',
      actor_id: ALEX,
      note: 'Two different people',
      occurred_at: clock,
    });
    await expect(as(ALEX, w1, (ctx) => candidates.unmergePeople(ctx, mergeId, 'again'))).rejects.toMatchObject({
      code: 'merge_not_found',
    });
  });

  it('after the 30-day window an undo is refused', async () => {
    clock = NOW;
    const { mergeId: late } = await as(MARIA, w1, (ctx) =>
      candidates.mergePeople(ctx, layla.personId, dup.personId, 'Same person after all'),
    );
    clock = new Date(NOW.getTime() + 30 * DAY);
    await expect(as(ALEX, w1, (ctx) => candidates.unmergePeople(ctx, late, 'Too late'))).rejects.toMatchObject({
      code: 'undo_expired',
    });
    clock = NOW;
  });
});

describe('Scenario: Never merge across workspaces', () => {
  it("detection in W1 never proposes W2's person with the same email and name", async () => {
    const jobW1 = await newJob('Data Engineer');
    const jobW2 = await as(
      ALEX,
      w2,
      async (ctx) =>
        (
          await jobs.createJob(ctx, {
            title: 'Data Engineer',
            jobType: 'ai_llm_engineering',
            description: 'x',
            synthetic: true,
          })
        ).id,
    );
    const inW2 = await arrive(jobW2, 'Priya Nair', 'email', { email: 'priya.nair@example.com' }, w2);
    const inW1 = await arrive(jobW1, 'Priya Nair', 'linkedin', { email: 'priya.nair@example.com', cv: 31 });
    expect(inW1.personId).not.toBe(inW2.personId);
    const [report] = await as(ALEX, w1, (ctx) => candidates.detectDuplicates(ctx, [inW1.personId, inW2.personId]));
    expect(report).toEqual({ personId: inW1.personId, possible: [], merged: [] });
    await expect(
      as(ALEX, w1, (ctx) => candidates.mergePeople(ctx, inW1.personId, inW2.personId, 'Same Priya')),
    ).rejects.toMatchObject({ code: 'merge_people' });
  });

  // SAFETY: mutation check: ALTER POLICY merge_tenant_isolation USING (true) -> this test failed (W2 saw W1's merges)
  it("row-level security hides W1's merges from W2 and from a session with no workspace, with no WHERE clause", async () => {
    expect((await rows(sql`select workspace_id from candidates.merge`)).length).toBeGreaterThan(0);
    expect(await rows(sql`select * from candidates.merge`, w2)).toEqual([]);
    expect([...(await app.execute(sql`select * from candidates.merge`))]).toEqual([]);
  });
});

describe('Scenario: Interviewers cannot merge', () => {
  it('mergePeople, detection and undo as an interviewer are 403', async () => {
    const job = await newJob('ML Platform Engineer');
    const a = await arrive(job, 'Daniel Novak', 'email', { cv: 41 });
    const b = await arrive(job, 'Daniel Novak', 'linkedin', { cv: 42 });
    await expect(as(LINA, w1, (ctx) => candidates.mergePeople(ctx, a.personId, b.personId, 'x'))).rejects.toThrow(
      ForbiddenError,
    );
    await expect(as(LINA, w1, (ctx) => candidates.detectDuplicates(ctx, [b.personId]))).rejects.toThrow(ForbiddenError);
    const { mergeId } = await as(MARIA, w1, (ctx) =>
      candidates.mergePeople(ctx, a.personId, b.personId, 'Same Daniel'),
    );
    await expect(as(LINA, w1, (ctx) => candidates.unmergePeople(ctx, mergeId, 'x'))).rejects.toThrow(ForbiddenError);
    expect((await as(ALEX, w1, (ctx) => candidates.getPerson(ctx, b.personId)))?.mergedIntoId).toBe(a.personId);
  });
});

describe('Undo moves back exactly what the merge moved (intake applicationRecords)', () => {
  // SAFETY: mutation check: restore ignored applicationSourceIds (moved the application back whole) -> this test failed (email went to the merged person)
  it("a source that arrived on a moved application after the merge stays with the survivor, in the survivor's application for that job", async () => {
    clock = NOW;
    const first = await newJob('Data Scientist');
    const second = await newJob('Forward Deployed Engineer');
    const fatima = await arrive(first, 'Fatima Al Hammadi', 'referral', { cv: 61 });
    const dup = await arrive(second, 'Fatima Al Hammadi', 'whatsapp', { cv: 62 });
    const { mergeId } = await as(MARIA, w1, (ctx) =>
      candidates.mergePeople(ctx, fatima.personId, dup.personId, 'Same person, two CVs'),
    );
    const later = await arrive(second, 'Fatima Al Hammadi', 'email', { cv: 61 });
    expect([later.personId, later.applicationId]).toEqual([fatima.personId, dup.applicationId]);
    await as(ALEX, w1, (ctx) => candidates.unmergePeople(ctx, mergeId, 'Two different people'));
    expect(await applicationsOf(dup.personId)).toEqual([
      { id: dup.applicationId, job_id: second, sources: ['whatsapp'] },
    ]);
    expect(await applicationsOf(fatima.personId)).toEqual([
      { id: fatima.applicationId, job_id: first, sources: ['referral'] },
      { id: expect.any(String), job_id: second, sources: ['email'] },
    ]);
  });

  it('a merge stored before applicationSourceIds still undoes: its applications move back whole', async () => {
    clock = NOW;
    const job = await newJob('Applied Scientist');
    const anna = await arrive(job, 'Anna Schmidt', 'linkedin', { cv: 63 });
    const other = await newJob('Research Engineer');
    const dup = await arrive(other, 'Anna Schmidt', 'referral', { cv: 64 });
    const { mergeId } = await as(MARIA, w1, (ctx) =>
      candidates.mergePeople(ctx, anna.personId, dup.personId, 'Same Anna'),
    );
    await admin.execute(
      sql`update candidates.merge set moved = moved #- '{applications,applicationSourceIds}' where id = ${mergeId}`,
    );
    await as(ALEX, w1, (ctx) => candidates.unmergePeople(ctx, mergeId, 'Two different people'));
    expect(await applicationsOf(dup.personId)).toEqual([
      { id: dup.applicationId, job_id: other, sources: ['referral'] },
    ]);
  });

  // SAFETY: mutation check: dropped eq(source.candidateId, fromId) from evidence's moveSource -> this test failed (Mark's repository went to Youssef)
  it("evidence moves only what it finds where the merge left it: a stale record moves nothing, so another person's evidence stays", async () => {
    clock = NOW;
    const job = await newJob('ML Platform Engineer');
    const mark = await arrive(job, 'Mark Reyes', 'linkedin', { cv: 71 });
    const youssef = await arrive(job, 'Youssef Aziz', 'referral', { cv: 72 });
    const { sourceId } = await repository(mark.personId, 'mark-ocr');
    await withWorkspace(app, w1, (tx) =>
      createEvidenceRecords(now).restore(
        tx,
        w1,
        youssef.personId,
        crypto.randomUUID(),
        { sourceIds: [sourceId], requestIds: [] },
        crypto.randomUUID(),
      ),
    );
    expect(await sourcesOf(mark.personId)).toEqual([sourceId]);
    expect(await sourcesOf(youssef.personId)).toEqual([]);
  });
});

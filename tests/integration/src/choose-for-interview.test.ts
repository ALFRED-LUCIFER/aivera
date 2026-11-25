import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createAudit } from '@credalent/audit/composition';
import { createCandidates, displayNamesInWorkspace } from '@credalent/candidates/composition';
import { createDb, withWorkspace, type Db } from '@credalent/db';
import type { IntakeContract, InterviewPorts } from '@credalent/intake';
import { createIntake, findApplication } from '@credalent/intake/composition';
import type { InterviewsContract } from '@credalent/interviews';
import { createInterviews } from '@credalent/interviews/composition';
import type { Competency, JobsContract } from '@credalent/jobs';
import { createApprovedRubricReads, createJobs } from '@credalent/jobs/composition';
import { ForbiddenError, type WorkspaceContext, type WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P1-114 acceptance scenarios against real PostgreSQL, as the non-owner aivera_app role (ADR-004, ADR-005): intake's
// choose-for-interview with the real interviews, workspaces and audit modules. The assessment's gaps are a fixed port
// here (`selectGaps` is tested in the assessment module; apps/web/src/server/intake.ts wires it). Synthetic cast only.

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const AYESHA = '0190d4a2-0000-7000-8000-0000000a1e5a'; // admin, creator of both workspaces
const ZAID = '0190d4a2-0000-7000-8000-00000000a1d0'; // recruiter
const FAISAL = '0190d4a2-0000-7000-8000-0000000fa15a'; // hiring owner granted Senior AI Engineer
const LINA = '0190d4a2-0000-7000-8000-0000000011aa'; // interviewer granted Senior AI Engineer
const NOW = new Date('2026-11-25T05:00:00.000Z');
const REASON = 'First shortlist';

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let workspaces: WorkspacesContract;
let jobs: JobsContract;
let intake: IntakeContract;
let interviews: InterviewsContract;
let w1: string;
let w2: string;
let seniorAi: string;
let qa: string;
let retrieval: string;
let w2Job: string;
const applications = new Map<string, string>();

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
const as = <T>(userId: string, workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId }, workspaceId, fn);
const competency = (name: string, weightPercent: number): Competency => ({
  name,
  evidenceExpected: 'A repository, a document or a reference',
  weightPercent,
  levelNeeded: 3,
  type: 'mandatory',
  origin: 'from_description',
});
const idOf = (name: string) => {
  const id = applications.get(name);
  if (!id) throw new Error(`No application for ${name}`);
  return id;
};

const intakeWith = (ports: InterviewPorts) =>
  createIntake(
    workspaces,
    createCandidates(workspaces, () => NOW),
    jobs,
    displayNamesInWorkspace,
    createAudit(app, () => NOW),
    () => NOW,
    ports,
  );

const choose = (userId: string, workspaceId: string, jobId: string, names: string[], via = intake) =>
  as(userId, workspaceId, (ctx) =>
    via.chooseForInterview(ctx, { jobId, applicationIds: names.map(idOf), reason: REASON }),
  );

const stageOf = async (name: string) =>
  (await admin.execute<{ stage: string }>(sql`select stage from intake.application where id = ${idOf(name)}`))[0]
    ?.stage;
const interviewsOf = (name: string) =>
  admin.execute<{ id: string; round: string; status: string; interviewer: string; competencies: string[] }>(sql`
    select id, round, status, interviewer_user_id as interviewer, competency_ids as competencies
    from interviews.interview where application_id = ${idOf(name)}`);
const auditsOf = (name: string) =>
  admin.execute<{ actor: string; at: Date; note: string; before: unknown; after: unknown }>(sql`
    select actor_id as actor, occurred_at as at, note, before, after from audit.entry
    where action = 'application.stage_changed' and subject_type = 'application' and subject_id = ${idOf(name)}
    order by seq`);
/**
 * Every row of every module's outbox and the send log: anything that would reach a candidate leaves through an outbox
 * (AIV-P0-014) or is logged in `notifications.message`.
 */
const outboxRows = async () => {
  const tables = await admin.execute<{ schema: string }>(
    sql`select table_schema as schema from information_schema.tables where table_name = 'outbox'`,
  );
  let n = 0;
  for (const { schema } of tables)
    n += Number(
      (await admin.execute<{ n: string }>(sql`select count(*) as n from ${sql.raw(`"${schema}".outbox`)}`))[0]?.n,
    );
  return n + Number((await admin.execute<{ n: string }>(sql`select count(*) as n from notifications.message`))[0]?.n);
};

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 1 });
  const audit = createAudit(app);
  workspaces = createWorkspaces(app, audit);
  jobs = createJobs(workspaces, audit, () => NOW);
  interviews = createInterviews(
    workspaces,
    jobs,
    createApprovedRubricReads().approvedRubric,
    findApplication,
    () => NOW,
  );
  intake = intakeWith({
    createInterview: (ctx, input) => interviews.createInterview(ctx, input),
    interviewGaps: async () => [retrieval],
  });
  const newWorkspace = async (name: string) =>
    (
      await workspaces.createWorkspace({
        name,
        company: name,
        hiringFocus: 'AI',
        synthetic: true,
        creatorUserId: AYESHA,
      })
    ).id;
  w1 = await newWorkspace('Demo Hiring Co');
  w2 = await newWorkspace('Gulf Talent Partners');
  await withWorkspace(app, w1, (tx) =>
    tx.execute(sql`insert into workspaces.member (workspace_id, user_id, role, status) values
      (${w1}, ${ZAID}, 'recruiter', 'active'), (${w1}, ${FAISAL}, 'hiring_owner', 'active'),
      (${w1}, ${LINA}, 'interviewer', 'active')`),
  );
  // Zaid is a recruiter in W2 too: "a recruiter in another workspace".
  await withWorkspace(app, w2, (tx) =>
    tx.execute(
      sql`insert into workspaces.member (workspace_id, user_id, role, status) values (${w2}, ${ZAID}, 'recruiter', 'active')`,
    ),
  );
  const newJob = async (workspaceId: string, title: string) => {
    const job = await as(AYESHA, workspaceId, (ctx) =>
      jobs.createJob(ctx, {
        title,
        jobType: 'ai_llm_engineering',
        description: `${title}, synthetic.`,
        synthetic: true,
      }),
    );
    const saved = await as(AYESHA, workspaceId, (ctx) =>
      jobs.saveRubric(ctx, job.id, {
        successStatement: 'Ships reliable AI features.',
        competencies: [competency('Retrieval and evaluation', 50), competency('LLM systems in production', 50)],
      }),
    );
    const sent = await as(AYESHA, workspaceId, (ctx) => jobs.submitRubric(ctx, saved.id));
    await as(AYESHA, workspaceId, (ctx) => jobs.approveRubric(ctx, sent.id, sent.revision));
    return job.id;
  };
  seniorAi = await newJob(w1, 'Senior AI Engineer');
  qa = await newJob(w1, 'QA Automation Engineer');
  const rubric = await withWorkspace(app, w1, (tx) => createApprovedRubricReads().approvedRubric(tx, w1, seniorAi));
  retrieval = rubric?.competencies.find((c) => c.name === 'Retrieval and evaluation')?.id ?? '';
  for (const userId of [FAISAL, LINA])
    await as(AYESHA, w1, (ctx) => workspaces.grantJobAccess(ctx, { userId, jobId: seniorAi }));
  const apply = async (workspaceId: string, jobId: string, name: string, key = name) => {
    const { applicationId } = await as(AYESHA, workspaceId, (ctx) =>
      intake.receiveApplication(ctx, {
        jobId,
        person: {
          displayName: name,
          identifiers: [{ type: 'email', value: `${key.toLowerCase().replaceAll(' ', '.')}@example.com` }],
          synthetic: true,
        },
        source: 'careers_page',
      }),
    );
    applications.set(key, applicationId);
  };
  for (const name of ['Daniel Novak', 'Priya Nair', 'Omar Al Suwaidi', 'Maria Santos', 'Arjun Menon'])
    await apply(w1, seniorAi, name);
  await apply(w1, qa, 'Sara Al Qahtani', 'Sara on QA');
  w2Job = await newJob(w2, 'Senior AI Engineer');
  await apply(w2, w2Job, 'Layla Haddad', 'Layla in W2');
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

describe('Migrations', () => {
  it('the stage and audit checks accept the new values, and still refuse a rejected stage', async () => {
    await expect(
      withWorkspace(app, w1, (tx) =>
        tx.execute(sql`update intake.application set stage = 'rejected' where id = ${idOf('Arjun Menon')}`),
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'application_stage_check' });
  });

  // SAFETY: mutation check: left 'application.stage_changed' out of entry_note_check -> this test failed (the insert succeeded)
  it('the database refuses a stage change audited with no reason', async () => {
    await expect(
      withWorkspace(app, w1, (tx) =>
        tx.execute(sql`insert into audit.entry (id, workspace_id, occurred_at, actor_type, actor_id, action, subject_type,
          subject_id, note) values (gen_random_uuid(), ${w1}, now(), 'user', ${ZAID}, 'application.stage_changed',
          'application', ${idOf('Arjun Menon')}, ' ')`),
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'entry_note_check' });
  });
});

describe('Scenario: Preview, then confirm', () => {
  // SAFETY: mutation check: wrote ApplicationReceived.v1 to intake's outbox from chooseForInterview -> this test failed (outbox rows 2 more)
  it('moves both to interview, each with a Round 1 interview not scheduled yet, audited with the reason; nobody is contacted', async () => {
    const outboxBefore = await outboxRows();
    const result = await choose(ZAID, w1, seniorAi, ['Daniel Novak', 'Priya Nair']);
    expect(result.skipped).toEqual([]);
    expect(result.chosen.map((c) => c.applicationId)).toEqual([idOf('Daniel Novak'), idOf('Priya Nair')]);
    for (const name of ['Daniel Novak', 'Priya Nair']) {
      expect(await stageOf(name)).toBe('interview');
      const [interview, ...more] = await interviewsOf(name);
      expect(more).toEqual([]);
      expect(interview).toMatchObject({
        round: 'structured_screen',
        status: 'to_schedule',
        interviewer: ZAID,
        competencies: [retrieval],
      });
      const [entry, ...others] = await auditsOf(name);
      expect(others).toEqual([]);
      expect({ ...entry, at: new Date(String(entry?.at)) }).toEqual({
        actor: ZAID,
        at: NOW,
        note: REASON,
        before: { stage: 'new' },
        after: { stage: 'interview', jobId: seniorAi, interviewId: interview?.id },
      });
    }
    // The Interviews page lists both as not scheduled yet.
    const listed = await as(ZAID, w1, (ctx) => interviews.listInterviews(ctx, 'ongoing'));
    expect(listed.filter((i) => i.jobId === seniorAi).map((i) => [i.applicationId, i.status])).toEqual(
      expect.arrayContaining([
        [idOf('Daniel Novak'), 'to_schedule'],
        [idOf('Priya Nair'), 'to_schedule'],
      ]),
    );
    expect(await outboxRows()).toBe(outboxBefore);
  });

  it('Scenario: Everyone else stays visible and unchanged', async () => {
    const listed = await as(ZAID, w1, (ctx) => intake.listApplicationsForJob(ctx, seniorAi));
    expect(listed).toHaveLength(5);
    expect(await stageOf('Omar Al Suwaidi')).toBe('new');
    expect(await stageOf('Maria Santos')).toBe('new');
    expect(await interviewsOf('Omar Al Suwaidi')).toEqual([]);
  });
});

describe('Scenario: Someone already chosen is not chosen twice', () => {
  // SAFETY: mutation check: removed `application.stage === 'interview' ||` from the skip -> this test failed (Daniel had 2 interviews)
  it('creates one interview, for the new person only', async () => {
    const result = await choose(ZAID, w1, seniorAi, ['Daniel Novak', 'Omar Al Suwaidi']);
    expect(result.skipped).toEqual([idOf('Daniel Novak')]);
    expect(result.chosen.map((c) => c.applicationId)).toEqual([idOf('Omar Al Suwaidi')]);
    expect(await interviewsOf('Daniel Novak')).toHaveLength(1);
    expect(await auditsOf('Daniel Novak')).toHaveLength(1);
    expect(await interviewsOf('Omar Al Suwaidi')).toHaveLength(1);
  });
});

describe('Scenario: An application from another job is refused', () => {
  // SAFETY: mutation check: replaced `application?.jobId !== job.jobId` with `!application` -> this test failed (resolved)
  it('"This candidate has not applied to this job", and nothing changes for anyone named', async () => {
    await expect(choose(ZAID, w1, seniorAi, ['Maria Santos', 'Sara on QA'])).rejects.toMatchObject({
      code: 'not_on_job',
      message: 'This candidate has not applied to this job',
    });
    expect(await stageOf('Maria Santos')).toBe('new');
    expect(await stageOf('Sara on QA')).toBe('new');
    expect(await interviewsOf('Maria Santos')).toEqual([]);
    expect(await auditsOf('Maria Santos')).toEqual([]);
  });
});

describe('Rollback', () => {
  it('when the interview insert fails, the stage, the interview and the audit entry all roll back', async () => {
    const failing = intakeWith({
      createInterview: (ctx, input) => interviews.createInterview(ctx, input),
      // Not a competency of the approved rubric: createInterview refuses after the stage has moved.
      interviewGaps: async () => ['0190d4a2-0000-7000-9000-00000000dead'],
    });
    await expect(choose(ZAID, w1, seniorAi, ['Maria Santos'], failing)).rejects.toMatchObject({
      code: 'competency_not_in_rubric',
    });
    expect(await stageOf('Maria Santos')).toBe('new');
    expect(await interviewsOf('Maria Santos')).toEqual([]);
    expect(await auditsOf('Maria Santos')).toEqual([]);
  });
});

describe('Scenario Outline: Only recruiters and admins on the job choose', () => {
  // Two layers refuse here: intake's own `interview.schedule` check, and createInterview's. Removing intake's alone
  // stays green in this test (createInterview refuses and the transaction rolls back); the unit test
  // (modules/intake/src/application/applications.test.ts) pins intake's check, mutation-checked.
  it.each([
    ["the job's hiring owner", FAISAL],
    ['an interviewer granted "Senior AI Engineer"', LINA],
  ])('%s is refused (403) and nothing changes', async (_who, userId) => {
    await expect(choose(userId, w1, seniorAi, ['Arjun Menon'])).rejects.toThrow(ForbiddenError);
    expect(await stageOf('Arjun Menon')).toBe('new');
    expect(await interviewsOf('Arjun Menon')).toEqual([]);
  });

  it('a recruiter in another workspace: the job is not found, and nothing changes', async () => {
    await expect(choose(ZAID, w2, seniorAi, ['Arjun Menon'])).rejects.toMatchObject({ code: 'job_not_found' });
    expect(await stageOf('Arjun Menon')).toBe('new');
  });
});

describe('Tenancy', () => {
  it("another workspace's application is not this job's, and RLS alone hides it with the repository filter removed", async () => {
    await expect(choose(ZAID, w1, seniorAi, ['Layla in W2'])).rejects.toMatchObject({ code: 'not_on_job' });
    expect(await stageOf('Layla in W2')).toBe('new');
    // W2 has an interview of its own, so the unfiltered read below has something to hide.
    const noGaps = intakeWith({
      createInterview: (ctx, input) => interviews.createInterview(ctx, input),
      interviewGaps: async () => [],
    });
    await choose(AYESHA, w2, w2Job, ['Layla in W2'], noGaps);
    expect(await interviewsOf('Layla in W2')).toHaveLength(1);
    // SAFETY: mutation check: ran the select below with RLS disabled on interviews.interview (`alter table ... no force row level security; disable row level security`) -> this test failed (W2's interview came back)
    // No WHERE clause, as the app role in W1: only W1's applications and interviews come back.
    const seen = await withWorkspace(app, w1, async (tx) => ({
      applications: await tx.execute<{ id: string }>(sql`select id from intake.application`),
      interviews: await tx.execute<{ w: string }>(sql`select workspace_id as w from interviews.interview`),
    }));
    expect(seen.applications.map((r) => r.id)).not.toContain(idOf('Layla in W2'));
    expect(new Set(seen.interviews.map((r) => r.w))).toEqual(new Set([w1]));
  });
});

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createAudit } from '@credalent/audit/composition';
import { createCandidates, displayNamesInWorkspace } from '@credalent/candidates/composition';
import { createDb, withWorkspace, type Db } from '@credalent/db';
import type { IntakeContract } from '@credalent/intake';
import { createIntake, findApplication } from '@credalent/intake/composition';
import {
  scorecardDueDays,
  toInterviewNoteEvidence,
  type InterviewsContract,
  type ScorecardDraft,
} from '@credalent/interviews';
import { createInterviews } from '@credalent/interviews/composition';
import type { Competency, JobsContract } from '@credalent/jobs';
import { createApprovedRubricReads, createJobs } from '@credalent/jobs/composition';
import type { WorkspaceContext, WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P2-001 acceptance scenarios against real PostgreSQL, connected as the non-owner aivera_app role (ADR-004, ADR-005).
// Synthetic cast only (docs/00-product/personas.md).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const AYESHA = '0190d4a2-0000-7000-8000-0000000a1e5a'; // recruiter, creator of both workspaces ("you")
const LINA = '0190d4a2-0000-7000-8000-0000000011aa'; // interviewer granted Senior AI Engineer
const HUDA = '0190d4a2-0000-7000-8000-00000000d0da'; // interviewer with no grant
const FAISAL = '0190d4a2-0000-7000-8000-0000000fa15a'; // hiring owner granted Senior AI Engineer
const ZAID = '0190d4a2-0000-7000-8000-00000000a1d0'; // recruiter, not an admin (AIV-P2-004)
const NOW = new Date('2026-11-18T05:00:00.000Z'); // 18 Nov, 09:00 in Dubai
const TODAY_1400 = new Date('2026-11-18T10:00:00.000Z'); // today, 14:00 in Dubai
const ROUND1 = 'structured_screen';

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let workspaces: WorkspacesContract;
let jobs: JobsContract;
let intake: IntakeContract;
let interviews: InterviewsContract;
let w1: string;
let w2: string;
/** Senior AI Engineer in W1: rubric version 2 approved, its competencies by name, and version 1's. */
let seniorAi: { jobId: string; v2: Map<string, string>; v1Only: string };
let danielApplication: string;

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

const newJob = (workspaceId: string, title: string) =>
  as(
    AYESHA,
    workspaceId,
    async (ctx) =>
      (
        await jobs.createJob(ctx, {
          title,
          jobType: 'ai_llm_engineering',
          description: `${title}, synthetic.`,
          synthetic: true,
        })
      ).id,
  );

/** Saves the job's next rubric version, sends it and approves it; returns its competency ids by name. */
const approvedVersion = async (workspaceId: string, jobId: string, competencies: Competency[]) => {
  const saved = await as(AYESHA, workspaceId, (ctx) =>
    jobs.saveRubric(ctx, jobId, { successStatement: 'Ships reliable AI features.', competencies }),
  );
  const sent = await as(AYESHA, workspaceId, (ctx) => jobs.submitRubric(ctx, saved.id));
  await as(AYESHA, workspaceId, (ctx) => jobs.approveRubric(ctx, sent.id, sent.revision));
  const rubric = await withWorkspace(app, workspaceId, (tx) =>
    createApprovedRubricReads().approvedRubric(tx, workspaceId, jobId),
  );
  return new Map((rubric?.competencies ?? []).map((c) => [c.name, c.id]));
};

const apply = async (workspaceId: string, jobId: string, name: string) =>
  (
    await as(AYESHA, workspaceId, (ctx) =>
      intake.receiveApplication(ctx, {
        jobId,
        person: {
          displayName: name,
          identifiers: [{ type: 'email', value: `${name.toLowerCase().replaceAll(' ', '.')}@example.com` }],
          synthetic: true,
        },
        source: 'careers_page',
      }),
    )
  ).applicationId;

const idOf = (name: string) => {
  const id = seniorAi.v2.get(name);
  if (!id) throw new Error(`No competency ${name} in version 2`);
  return id;
};

/** An interview row written straight to W1, past the module, to reach the database's own checks. */
const rawInsert = (status: string, scheduledAt: Date | null) =>
  withWorkspace(app, w1, (tx) =>
    tx.execute(sql`insert into interviews.interview (id, workspace_id, application_id, job_id, candidate_id, round,
      interviewer_user_id, scheduled_at, status, rubric_version_id, competency_ids, created_by, created_at)
      values (gen_random_uuid(), ${w1}, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'panel',
      ${AYESHA}, ${scheduledAt}, ${status}, gen_random_uuid(), '{}', ${AYESHA}, now())`),
  );

const count = async (table: string) =>
  Number((await admin.execute<{ n: string }>(sql`select count(*) as n from ${sql.raw(table)}`))[0]?.n);

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
  intake = createIntake(
    workspaces,
    createCandidates(workspaces, () => NOW),
    jobs,
    displayNamesInWorkspace,
    audit,
    () => NOW,
  );
  interviews = createInterviews(
    workspaces,
    jobs,
    createApprovedRubricReads().approvedRubric,
    findApplication,
    () => NOW,
  );
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
    tx.execute(
      sql`insert into workspaces.member (workspace_id, user_id, role, status) values (${w1}, ${LINA}, 'interviewer', 'active'),
        (${w1}, ${HUDA}, 'interviewer', 'active')`,
    ),
  );

  // Background: "Senior AI Engineer" on approved rubric version 2, and Daniel Novak's application on it.
  const jobId = await newJob(w1, 'Senior AI Engineer');
  const v1 = await approvedVersion(w1, jobId, [
    competency('Prompt engineering', 50),
    competency('Cost and reliability', 50),
  ]);
  const v2 = await approvedVersion(w1, jobId, [
    competency('Retrieval and evaluation', 40),
    competency('Cost and reliability', 30),
    competency('LLM systems in production', 30),
  ]);
  seniorAi = { jobId, v2, v1Only: v1.get('Prompt engineering') ?? '' };
  await as(AYESHA, w1, (ctx) => workspaces.grantJobAccess(ctx, { userId: LINA, jobId }));
  danielApplication = await apply(w1, jobId, 'Daniel Novak');
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

describe('Migrations', () => {
  it('interviews tables are owned by aivera_migrator with row-level security enabled and forced', async () => {
    const tables = await admin.execute<{ name: string; owner: string; rls: boolean; forced: boolean }>(sql`
      select t.tablename as name, t.tableowner as owner, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_tables t join pg_class c on c.oid = format('%I.%I', t.schemaname, t.tablename)::regclass
      where t.schemaname = 'interviews' order by name`);
    expect([...tables]).toEqual([
      { name: 'inbox', owner: 'aivera_migrator', rls: true, forced: true },
      { name: 'interview', owner: 'aivera_migrator', rls: true, forced: true },
      { name: 'meeting_summaries', owner: 'aivera_migrator', rls: true, forced: true },
      { name: 'outbox', owner: 'aivera_migrator', rls: true, forced: true },
      { name: 'scorecard_drafts', owner: 'aivera_migrator', rls: true, forced: true },
      { name: 'summary_proposals', owner: 'aivera_migrator', rls: true, forced: true },
    ]);
  });

  it('applying the migrations again is a no-op', async () => {
    const applied = await count('migrations.interviews');
    expect(applied).toBe(6);
    execFileSync(process.execPath, [dbCli, 'migrate'], {
      env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
    });
    expect(await count('migrations.interviews')).toBe(applied);
  });
});

describe('Scenario: Schedule a Round 1 interview', () => {
  // SAFETY: mutation check: removed publishInterviewScheduled from createInterview -> this test failed (no event)
  it('Round 1 for Daniel Novak today at 14:00 with "you" is stored scheduled, with InterviewScheduled.v1 in the outbox', async () => {
    const { interviewId } = await as(AYESHA, w1, (ctx) =>
      interviews.createInterview(ctx, {
        applicationId: danielApplication,
        round: ROUND1,
        interviewerUserId: AYESHA,
        scheduledAt: TODAY_1400,
        competencyIds: [idOf('Retrieval and evaluation'), idOf('Cost and reliability')],
      }),
    );
    const stored = await as(AYESHA, w1, (ctx) => interviews.getInterview(ctx, interviewId));
    expect(stored).toMatchObject({
      jobId: seniorAi.jobId,
      round: ROUND1,
      interviewerUserId: AYESHA,
      scheduledAt: TODAY_1400,
      status: 'scheduled',
      competencyIds: [idOf('Retrieval and evaluation'), idOf('Cost and reliability')],
    });
    const events = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ type: string; payload: unknown }>(
        sql`select type, payload from interviews.outbox where payload->>'interviewId' = ${interviewId}`,
      ),
    );
    expect([...events]).toEqual([
      { type: 'InterviewScheduled.v1', payload: { interviewId, applicationId: danielApplication } },
    ]);
  });

  it('a rolled-back schedule writes neither the interview nor the event (same transaction)', async () => {
    const before = [await count('interviews.interview'), await count('interviews.outbox')];
    await expect(
      as(AYESHA, w1, async (ctx) => {
        await interviews.createInterview(ctx, {
          applicationId: danielApplication,
          round: 'evidence_defence',
          interviewerUserId: AYESHA,
          scheduledAt: TODAY_1400,
          competencyIds: [idOf('Retrieval and evaluation')],
        });
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect([await count('interviews.interview'), await count('interviews.outbox')]).toEqual(before);
  });
});

describe('Scenario: Competencies must come from the approved rubric', () => {
  it('a competency not in rubric version 2 (one only version 1 had) is rejected and nothing is stored', async () => {
    const before = [await count('interviews.interview'), await count('interviews.outbox')];
    await expect(
      as(AYESHA, w1, (ctx) =>
        interviews.createInterview(ctx, {
          applicationId: danielApplication,
          round: ROUND1,
          interviewerUserId: AYESHA,
          scheduledAt: TODAY_1400,
          competencyIds: [idOf('Cost and reliability'), seniorAi.v1Only],
        }),
      ),
    ).rejects.toThrow("This competency is not in the job's approved rubric");
    expect([await count('interviews.interview'), await count('interviews.outbox')]).toEqual(before);
  });
});

describe('Scenario: Interviews cannot be scheduled on a job without an approved rubric', () => {
  it('"Senior Product Designer" with rubric "Draft, needs approval": rejected and nothing is stored', async () => {
    const designer = await newJob(w1, 'Senior Product Designer');
    await as(AYESHA, w1, (ctx) =>
      jobs.saveRubric(ctx, designer, {
        successStatement: 'Ships.',
        competencies: [competency('Interaction design', 100)],
      }),
    );
    const application = await apply(w1, designer, 'Priya Nair');
    const before = [await count('interviews.interview'), await count('interviews.outbox')];
    await expect(
      as(AYESHA, w1, (ctx) =>
        interviews.createInterview(ctx, {
          applicationId: application,
          round: ROUND1,
          interviewerUserId: AYESHA,
          scheduledAt: TODAY_1400,
          competencyIds: [],
        }),
      ),
    ).rejects.toMatchObject({ code: 'rubric_not_approved' });
    expect([await count('interviews.interview'), await count('interviews.outbox')]).toEqual(before);
  });
});

describe('Scenario Outline: Only allowed status transitions (stored)', () => {
  it('scheduled to in_progress is accepted once; in_progress back to in_progress is rejected', async () => {
    const { interviewId } = await as(AYESHA, w1, (ctx) =>
      interviews.createInterview(ctx, {
        applicationId: danielApplication,
        round: 'panel',
        interviewerUserId: LINA,
        scheduledAt: TODAY_1400,
        competencyIds: [idOf('LLM systems in production')],
      }),
    );
    await as(LINA, w1, (ctx) => interviews.startInterview(ctx, interviewId));
    expect((await as(AYESHA, w1, (ctx) => interviews.getInterview(ctx, interviewId)))?.status).toBe('in_progress');
    await expect(as(LINA, w1, (ctx) => interviews.startInterview(ctx, interviewId))).rejects.toMatchObject({
      code: 'status_move',
    });
  });

  it('the database refuses a scheduled interview with no time and an unknown status', async () => {
    await expect(rawInsert('scheduled', null)).rejects.toThrow();
    await expect(rawInsert('to_schedule', NOW)).rejects.toThrow();
    await expect(rawInsert('rejected', NOW)).rejects.toThrow();
  });
});

describe('Scenario: Scorecard becomes due when the time passes', () => {
  it('Anjali Iyer\'s Round 1 on 16 Nov with no scorecard, listed on 18 Nov: "Scorecard due", 2 days', async () => {
    const anjali = await apply(w1, seniorAi.jobId, 'Anjali Iyer');
    const on16Nov = new Date('2026-11-16T06:00:00.000Z'); // 16 Nov, 10:00 in Dubai
    const { interviewId } = await as(AYESHA, w1, (ctx) =>
      interviews.createInterview(ctx, {
        applicationId: anjali,
        round: ROUND1,
        interviewerUserId: AYESHA,
        scheduledAt: on16Nov,
        competencyIds: [idOf('Cost and reliability')],
      }),
    );
    const ongoing = await as(AYESHA, w1, (ctx) => interviews.listInterviews(ctx, 'ongoing'));
    const hers = ongoing.find((i) => i.id === interviewId);
    expect(hers?.status).toBe('scorecard_due');
    expect(scorecardDueDays(on16Nov, NOW, 'Asia/Dubai')).toBe(2);
    // Computed, not written: the stored row is still "scheduled".
    const [row] = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ status: string }>(sql`select status from interviews.interview where id = ${interviewId}`),
    );
    expect(row?.status).toBe('scheduled');
    // Soonest first: her 16 Nov interview leads the list.
    expect(ongoing[0]?.id).toBe(interviewId);
  });
});

describe('Owner decision, 24 Nov 2026: an interview with no time yet', () => {
  it('is stored "to_schedule", announces nothing, and is listed as ongoing after the timed ones', async () => {
    const omar = await apply(w1, seniorAi.jobId, 'Omar Al Suwaidi');
    const { interviewId } = await as(AYESHA, w1, (ctx) =>
      interviews.createInterview(ctx, {
        applicationId: omar,
        round: ROUND1,
        interviewerUserId: AYESHA,
        competencyIds: [idOf('Retrieval and evaluation')],
      }),
    );
    const ongoing = await as(AYESHA, w1, (ctx) => interviews.listInterviews(ctx, 'ongoing'));
    expect(ongoing.at(-1)).toMatchObject({ id: interviewId, status: 'to_schedule', scheduledAt: null });
    const events = await withWorkspace(app, w1, (tx) =>
      tx.execute(sql`select 1 from interviews.outbox where payload->>'interviewId' = ${interviewId}`),
    );
    expect(events).toHaveLength(0);
    expect(await as(AYESHA, w1, (ctx) => interviews.listInterviews(ctx, 'completed'))).toEqual([]);
  });
});

describe('Who interviews and who sees interviews', () => {
  it('an interviewer with no grant on the job cannot be the interviewer', async () => {
    await expect(
      as(AYESHA, w1, (ctx) =>
        interviews.createInterview(ctx, {
          applicationId: danielApplication,
          round: ROUND1,
          interviewerUserId: HUDA,
          competencyIds: [],
        }),
      ),
    ).rejects.toMatchObject({ code: 'interviewer_not_on_job' });
  });

  it('an interviewer lists only the interviews they hold; one with no grant sees none', async () => {
    const mine = await as(LINA, w1, (ctx) => interviews.listInterviews(ctx, 'ongoing'));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((i) => i.interviewerUserId === LINA)).toBe(true);
    expect(await as(HUDA, w1, (ctx) => interviews.listInterviews(ctx, 'ongoing'))).toEqual([]);
  });

  it('an interviewer cannot plan interviews', async () => {
    await expect(
      as(LINA, w1, (ctx) =>
        interviews.createInterview(ctx, {
          applicationId: danielApplication,
          round: ROUND1,
          interviewerUserId: LINA,
          competencyIds: [],
        }),
      ),
    ).rejects.toThrow('Forbidden');
  });

  // The jobs module's job-scope row-level security hides an ungranted job, so its interviews drop out (not a 403).
  // SAFETY: mutation check: made the interviews jobResource port return every job ({ jobId, clientId: null }) -> this test failed (Staff Backend interview listed)
  it('a hiring owner granted Senior AI Engineer lists only its interviews, reads none of another job, starts none they do not hold', async () => {
    await withWorkspace(app, w1, (tx) =>
      tx.execute(
        sql`insert into workspaces.member (workspace_id, user_id, role, status) values (${w1}, ${FAISAL}, 'hiring_owner', 'active')`,
      ),
    );
    await as(AYESHA, w1, (ctx) => workspaces.grantJobAccess(ctx, { userId: FAISAL, jobId: seniorAi.jobId }));
    const backend = await newJob(w1, 'Staff Backend Engineer');
    const v = await approvedVersion(w1, backend, [competency('Distributed systems', 100)]);
    const rana = await apply(w1, backend, 'Rana Khoury');
    const { interviewId: other } = await as(AYESHA, w1, (ctx) =>
      interviews.createInterview(ctx, {
        applicationId: rana,
        round: ROUND1,
        interviewerUserId: AYESHA,
        scheduledAt: TODAY_1400,
        competencyIds: [...v.values()],
      }),
    );
    const listed = await as(FAISAL, w1, (ctx) => interviews.listInterviews(ctx, 'ongoing'));
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((i) => i.jobId === seniorAi.jobId)).toBe(true);
    expect(await as(FAISAL, w1, (ctx) => interviews.getInterview(ctx, other))).toBeNull();
    const ayeshas = listed.find((i) => i.interviewerUserId === AYESHA && i.status !== 'in_progress');
    await expect(as(FAISAL, w1, (ctx) => interviews.startInterview(ctx, ayeshas?.id ?? ''))).rejects.toThrow(
      'Forbidden',
    );
  });
});

// AIV-P2-004: the scorecard draft of Daniel Novak's Round 1, held by Lina, an interviewer granted Senior AI Engineer.
describe('Scorecard drafts (AIV-P2-004)', () => {
  const NOTE = 'Walked through the 200-question set he built';
  let round1: string;
  const draft = (note = NOTE): ScorecardDraft => ({
    competencies: [
      { competencyId: idOf('Retrieval and evaluation'), rating: 'clearly_shown', note, questions: [] },
      {
        competencyId: idOf('Cost and reliability'),
        rating: null,
        note: '',
        questions: [{ text: 'In the March incident, what did you do in the first thirty minutes?', mark: 'not_asked' }],
      },
    ],
    recommendation: 'shortlist',
  });
  const drafts = async () => [
    ...(await admin.execute<{ interview_id: string; updated_by: string; note: string }>(
      sql`select interview_id, updated_by, competencies->0->>'note' as note from interviews.scorecard_drafts
        where interview_id = ${round1}`,
    )),
  ];

  beforeAll(async () => {
    await withWorkspace(app, w1, (tx) =>
      tx.execute(
        sql`insert into workspaces.member (workspace_id, user_id, role, status) values (${w1}, ${ZAID}, 'recruiter', 'active')`,
      ),
    );
    ({ interviewId: round1 } = await as(AYESHA, w1, (ctx) =>
      interviews.createInterview(ctx, {
        applicationId: danielApplication,
        round: ROUND1,
        interviewerUserId: LINA,
        scheduledAt: TODAY_1400,
        competencyIds: [idOf('Retrieval and evaluation'), idOf('Cost and reliability')],
      }),
    ));
    await as(LINA, w1, (ctx) => interviews.startInterview(ctx, round1));
  });

  it('Scenario: Rate and note: the interviewer saves a draft, saves it again and reads it back; the interview is unchanged', async () => {
    await as(LINA, w1, (ctx) => interviews.saveScorecardDraft(ctx, round1, draft('First words')));
    await as(LINA, w1, (ctx) => interviews.saveScorecardDraft(ctx, round1, draft()));
    expect(await drafts()).toEqual([{ interview_id: round1, updated_by: LINA, note: NOTE }]);
    const read = await as(LINA, w1, (ctx) => interviews.getScorecard(ctx, round1));
    expect(read).toMatchObject({ canEdit: true, draft: draft(), interview: { id: round1, status: 'in_progress' } });
    // The evidence payloads the submit will write (AIV-P2-006): the rated competency only, not the one not asked.
    expect(
      toInterviewNoteEvidence({ interviewId: round1, authorMemberId: LINA, draft: read?.draft ?? draft('') }),
    ).toEqual([
      {
        kind: 'interview_note',
        interviewId: round1,
        competencyId: idOf('Retrieval and evaluation'),
        authorMemberId: LINA,
        rating: 'clearly_shown',
        note: NOTE,
      },
    ]);
  });

  it('a workspace admin who is not the interviewer saves too', async () => {
    await as(AYESHA, w1, (ctx) => interviews.saveScorecardDraft(ctx, round1, draft('Admin correction')));
    expect(await drafts()).toEqual([{ interview_id: round1, updated_by: AYESHA, note: 'Admin correction' }]);
  });

  it('Scenario Outline: a recruiter who is not the interviewer and not an admin is refused, and nothing is stored', async () => {
    const before = await drafts();
    await expect(as(ZAID, w1, (ctx) => interviews.saveScorecardDraft(ctx, round1, draft('Zaid')))).rejects.toThrow(
      'Forbidden',
    );
    expect(await drafts()).toEqual(before);
    // They see the interview, read-only, and never the interviewer's draft.
    expect(await as(ZAID, w1, (ctx) => interviews.getScorecard(ctx, round1))).toMatchObject({
      canEdit: false,
      draft: null,
    });
  });

  // Huda is an interviewer with no grant on Senior AI Engineer. The contract never makes her an interviewer of it
  // (interviewer_not_on_job), so the row is written past it: the grant is checked again when the draft is saved.
  // SAFETY: mutation check: removed the job-grant check from scorecardHolder (the jobResource read, `if (!job) throw new ForbiddenError()` and the authorize call) -> this test failed (the promise resolved: Huda's draft was stored)
  it('Scenario Outline: an interviewer with no grant on Senior AI Engineer is refused, and nothing is stored', async () => {
    const { interviewId } = await as(AYESHA, w1, (ctx) =>
      interviews.createInterview(ctx, {
        applicationId: danielApplication,
        round: 'evidence_defence',
        interviewerUserId: LINA,
        competencyIds: [idOf('Retrieval and evaluation')],
      }),
    );
    await withWorkspace(app, w1, (tx) =>
      tx.execute(sql`update interviews.interview set interviewer_user_id = ${HUDA} where id = ${interviewId}`),
    );
    const before = await count('interviews.scorecard_drafts');
    await expect(
      as(HUDA, w1, (ctx) =>
        interviews.saveScorecardDraft(ctx, interviewId, {
          competencies: [
            { competencyId: idOf('Retrieval and evaluation'), rating: 'not_shown', note: 'Huda', questions: [] },
          ],
          recommendation: null,
        }),
      ),
    ).rejects.toThrow('Forbidden');
    expect(await count('interviews.scorecard_drafts')).toBe(before);
  });

  it('Scenario: No overall judgement: the table holds the competencies, a recommendation and who saved it, nothing else', async () => {
    const columns = await admin.execute<{ column_name: string }>(sql`select column_name from information_schema.columns
      where table_schema = 'interviews' and table_name = 'scorecard_drafts' order by ordinal_position`);
    expect(columns.map((c) => c.column_name)).toEqual([
      'interview_id',
      'workspace_id',
      'competencies',
      'recommendation',
      'updated_by',
      'updated_at',
    ]);
    // A field the schema does not name never reaches the table, and the database knows the three recommendations.
    await expect(
      as(LINA, w1, (ctx) =>
        interviews.saveScorecardDraft(ctx, round1, { ...draft(), overallScore: 4 } as ScorecardDraft),
      ),
    ).rejects.toThrow();
    await expect(
      withWorkspace(app, w1, (tx) =>
        tx.execute(sql`update interviews.scorecard_drafts set recommendation = 'hire' where interview_id = ${round1}`),
      ),
    ).rejects.toThrow();
  });

  it('a draft of another workspace: its interview is not found from W1, and RLS alone hides the row', async () => {
    const jobId = await newJob(w2, 'Data Engineer');
    const v = await approvedVersion(w2, jobId, [competency('Retrieval and evaluation', 100)]);
    const application = await apply(w2, jobId, 'Mei Tanaka');
    const { interviewId } = await as(AYESHA, w2, (ctx) =>
      interviews.createInterview(ctx, {
        applicationId: application,
        round: ROUND1,
        interviewerUserId: AYESHA,
        competencyIds: [...v.values()],
      }),
    );
    const theirs: ScorecardDraft = {
      competencies: [...v.values()].map((competencyId) => ({
        competencyId,
        rating: 'partly_shown',
        note: 'W2 note',
        questions: [],
      })),
      recommendation: null,
    };
    await as(AYESHA, w2, (ctx) => interviews.saveScorecardDraft(ctx, interviewId, theirs));
    expect(await as(AYESHA, w1, (ctx) => interviews.getScorecard(ctx, interviewId))).toBeNull();
    await expect(
      as(AYESHA, w1, (ctx) => interviews.saveScorecardDraft(ctx, interviewId, theirs)),
    ).rejects.toMatchObject({ code: 'interview_not_found' });
    // SAFETY: mutation check: ALTER TABLE interviews.scorecard_drafts DISABLE ROW LEVEL SECURITY before this read -> this test failed (the W2 draft was read from W1)
    // The repository filter removed: a query with no WHERE clause, as the app role.
    const inW1 = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ workspace_id: string }>(sql`select workspace_id from interviews.scorecard_drafts`),
    );
    expect(inW1.length).toBeGreaterThan(0);
    expect(new Set(inW1.map((r) => r.workspace_id))).toEqual(new Set([w1]));
    expect(await app.execute(sql`select 1 from interviews.scorecard_drafts`)).toHaveLength(0);
  });

  it('a completed interview takes no more changes, and its draft goes with the interview', async () => {
    await withWorkspace(app, w1, (tx) =>
      tx.execute(sql`update interviews.interview set status = 'completed' where id = ${round1}`),
    );
    await expect(as(LINA, w1, (ctx) => interviews.saveScorecardDraft(ctx, round1, draft()))).rejects.toMatchObject({
      code: 'scorecard_submitted',
    });
    expect(await as(LINA, w1, (ctx) => interviews.getScorecard(ctx, round1))).toMatchObject({ canEdit: false });
    await withWorkspace(app, w1, (tx) => tx.execute(sql`delete from interviews.interview where id = ${round1}`));
    expect(await drafts()).toEqual([]);
  });
});

describe('Scenario: Workspace isolation', () => {
  let w2Interview: string;
  let w2Application: string;

  beforeAll(async () => {
    const jobId = await newJob(w2, 'Senior AI Engineer');
    const v = await approvedVersion(w2, jobId, [competency('Retrieval and evaluation', 100)]);
    w2Application = await apply(w2, jobId, 'Karim Nasser');
    ({ interviewId: w2Interview } = await as(AYESHA, w2, (ctx) =>
      interviews.createInterview(ctx, {
        applicationId: w2Application,
        round: ROUND1,
        interviewerUserId: AYESHA,
        scheduledAt: TODAY_1400,
        competencyIds: [...v.values()],
      }),
    ));
  });

  it('a member of W1 never lists or reads the W2 interview', async () => {
    const listed = await as(AYESHA, w1, (ctx) => interviews.listInterviews(ctx, 'ongoing'));
    expect(listed.map((i) => i.id)).not.toContain(w2Interview);
    expect(await as(AYESHA, w1, (ctx) => interviews.getInterview(ctx, w2Interview))).toBeNull();
  });

  it('a W2 application named inside W1 is not found and nothing is stored', async () => {
    const before = await count('interviews.interview');
    await expect(
      as(AYESHA, w1, (ctx) =>
        interviews.createInterview(ctx, {
          applicationId: w2Application,
          round: ROUND1,
          interviewerUserId: AYESHA,
          competencyIds: [],
        }),
      ),
    ).rejects.toMatchObject({ code: 'application_not_found' });
    expect(await count('interviews.interview')).toBe(before);
  });

  // SAFETY: mutation check: ALTER TABLE interviews.interview DISABLE ROW LEVEL SECURITY -> this test failed (W2 rows read)
  it('RLS alone: in W1 with no WHERE clause only W1 rows come back, and with no workspace set none do', async () => {
    const inW1 = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ workspace_id: string }>(sql`select workspace_id from interviews.interview`),
    );
    expect(inW1.length).toBeGreaterThan(0);
    expect(new Set(inW1.map((r) => r.workspace_id))).toEqual(new Set([w1]));
    const outboxInW1 = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ workspace_id: string }>(sql`select workspace_id from interviews.outbox`),
    );
    expect(new Set(outboxInW1.map((r) => r.workspace_id))).toEqual(new Set([w1]));
    expect(await app.execute(sql`select 1 from interviews.interview`)).toHaveLength(0);
    expect(await app.execute(sql`select 1 from interviews.outbox`)).toHaveLength(0);
  });
});

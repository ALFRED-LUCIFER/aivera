import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createAudit } from '@credalent/audit/composition';
import { createCandidates, displayNamesInWorkspace } from '@credalent/candidates/composition';
import { createDb, withWorkspace, type Db } from '@credalent/db';
import {
  IntakeError,
  SOURCES,
  type IntakeContract,
  type ReceiveApplicationInput,
  type Source,
} from '@credalent/intake';
import { createIntake } from '@credalent/intake/composition';
import { createJobs } from '@credalent/jobs/composition';
import type { JobsContract } from '@credalent/jobs';
import { ForbiddenError, type WorkspaceContext, type WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P1-017 acceptance scenarios against real PostgreSQL, connected as the non-owner aivera_app role (ADR-004, ADR-005).
// Synthetic cast only (docs/00-product/personas.md).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1';
const LINA = '0190d4a2-0000-7000-8000-0000000011aa';
const HUDA = '0190d4a2-0000-7000-8000-00000000d0da';
const NOW = new Date('2026-11-20T09:00:00.000Z');
const cvHash = (n: number) => n.toString(16).padStart(64, '0');

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let workspaces: WorkspacesContract;
let jobs: JobsContract;
let intake: IntakeContract;
let w1: string;
let w2: string;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const as = <T>(userId: string, workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId }, workspaceId, fn);

const newJob = (workspaceId: string, title: string) =>
  as(
    ALEX,
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

const arrival = (jobId: string, name: string, n: number, source: Source, email?: string): ReceiveApplicationInput => ({
  jobId,
  person: {
    displayName: name,
    identifiers: [{ type: 'cv_hash', value: cvHash(n) }, ...(email ? [{ type: 'email' as const, value: email }] : [])],
    synthetic: true,
  },
  source,
  fileIds: [crypto.randomUUID()],
  links: ['https://portfolio.credalent.example/candidate'],
});

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
    () => NOW,
  );
  const newWorkspace = async (name: string) =>
    (await workspaces.createWorkspace({ name, company: name, hiringFocus: 'AI', synthetic: true, creatorUserId: ALEX }))
      .id;
  w1 = await newWorkspace('Demo Hiring Co');
  w2 = await newWorkspace('Gulf Talent Partners');
  await withWorkspace(app, w1, (tx) =>
    tx.execute(
      sql`insert into workspaces.member (workspace_id, user_id, role, status) values (${w1}, ${LINA}, 'interviewer', 'active'),
        (${w1}, ${HUDA}, 'hiring_owner', 'active')`,
    ),
  );
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

describe('Migrations', () => {
  it('intake tables are owned by aivera_migrator with row-level security enabled and forced', async () => {
    const tables = await admin.execute<{ name: string; owner: string; rls: boolean; forced: boolean }>(sql`
      select t.tablename as name, t.tableowner as owner, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_tables t join pg_class c on c.oid = format('%I.%I', t.schemaname, t.tablename)::regclass
      where t.schemaname = 'intake' order by name`);
    expect([...tables]).toEqual([
      { name: 'application', owner: 'aivera_migrator', rls: true, forced: true },
      { name: 'application_source', owner: 'aivera_migrator', rls: true, forced: true },
      { name: 'outbox', owner: 'aivera_migrator', rls: true, forced: true },
    ]);
  });
});

describe('Scenario Outline: Each source is recorded', () => {
  it.each(SOURCES.map((source, i) => [source, i] as const))(
    'an application arriving from %s has that source',
    async (source, i) => {
      const jobId = await newJob(w1, 'QA Automation Engineer');
      const result = await as(ALEX, w1, (ctx) =>
        intake.receiveApplication(ctx, arrival(jobId, 'Paolo Garcia', 100 + i, source)),
      );
      expect(result.created).toBe(true);
      const rows = await withWorkspace(app, w1, (tx) =>
        tx.execute<{ source: string; stage: string }>(sql`select s.source, a.stage from intake.application_source s
        join intake.application a on a.id = s.application_id where a.id = ${result.applicationId}`),
      );
      expect([...rows]).toEqual([{ source, stage: 'new' }]);
    },
  );
});

describe('Scenario: A second arrival adds a source, not an application', () => {
  // SAFETY: mutation check: dropped application_person_job_key in intake 0000 -> this test failed (two applications)
  it('Sneha Iyer via LinkedIn, then the same CV by Email for the same job: one application, two sources', async () => {
    const jobId = await newJob(w1, 'Senior AI Engineer');
    const first = await as(ALEX, w1, (ctx) =>
      intake.receiveApplication(ctx, arrival(jobId, 'Sneha Iyer', 1, 'linkedin')),
    );
    const second = await as(ALEX, w1, (ctx) =>
      intake.receiveApplication(ctx, arrival(jobId, 'Sneha Iyer', 1, 'email', 'sneha.iyer@example.com')),
    );
    expect(second).toMatchObject({ applicationId: first.applicationId, personId: first.personId, created: false });
    const sources = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ source: string }>(
        sql`select source from intake.application_source where application_id = ${first.applicationId} order by source desc`,
      ),
    );
    expect(sources.map((r) => r.source)).toEqual(['linkedin', 'email']);
  });
});

describe('Scenario: One person, several jobs', () => {
  it('Youssef Aziz applies to 5 jobs with the same CV: one person and 5 applications', async () => {
    const results = [];
    for (let i = 0; i < 5; i++) {
      const jobId = await newJob(w1, `Job ${i + 1}`);
      results.push(
        await as(ALEX, w1, (ctx) => intake.receiveApplication(ctx, arrival(jobId, 'Youssef Aziz', 2, 'careers_page'))),
      );
    }
    expect(new Set(results.map((r) => r.personId)).size).toBe(1);
    expect(new Set(results.map((r) => r.applicationId)).size).toBe(5);
  });
});

describe('Scenario: Intake triggers ingestion through the outbox', () => {
  // SAFETY: mutation check: removed publishApplicationReceived from receiveApplication -> this test failed (no event)
  it('receiving an application writes ApplicationReceived.v1 with opaque ids only', async () => {
    const jobId = await newJob(w1, 'Data Engineer');
    const result = await as(ALEX, w1, (ctx) =>
      intake.receiveApplication(ctx, arrival(jobId, 'Anna Schmidt', 3, 'referral')),
    );
    const events = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ type: string; payload: unknown }>(
        sql`select type, payload from intake.outbox where payload->>'sourceId' = ${result.sourceId}`,
      ),
    );
    expect([...events]).toEqual([
      { type: 'ApplicationReceived.v1', payload: { applicationId: result.applicationId, sourceId: result.sourceId } },
    ]);
  });

  it('a rolled-back arrival writes neither the application nor the event', async () => {
    const jobId = await newJob(w1, 'Platform Engineer');
    const before = [
      await count('intake.application'),
      await count('intake.application_source'),
      await count('intake.outbox'),
    ];
    await expect(
      as(ALEX, w1, async (ctx) => {
        await intake.receiveApplication(ctx, arrival(jobId, 'Mark Reyes', 4, 'whatsapp'));
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect([
      await count('intake.application'),
      await count('intake.application_source'),
      await count('intake.outbox'),
    ]).toEqual(before);
  });
});

describe('Scenario: Applications to an unknown or other-workspace job are refused', () => {
  // SAFETY: mutation check: removed the jobExists check (now jobResource) from receiveApplication -> this test failed (no IntakeError, rows written)
  it('a job from W2 named inside W1 fails with "Job not found" and nothing is written', async () => {
    const w2Job = await newJob(w2, 'Gulf job');
    const before = [
      await count('candidates.person'),
      await count('candidates.outbox'),
      await count('intake.application'),
      await count('intake.application_source'),
      await count('intake.outbox'),
    ];
    const refused = as(ALEX, w1, (ctx) =>
      intake.receiveApplication(ctx, arrival(w2Job, 'Fatima Al Hammadi', 5, 'email')),
    );
    await expect(refused).rejects.toThrow(IntakeError);
    await expect(refused).rejects.toThrow('Job not found');
    await expect(
      as(ALEX, w1, (ctx) =>
        intake.receiveApplication(ctx, arrival(crypto.randomUUID(), 'Fatima Al Hammadi', 5, 'email')),
      ),
    ).rejects.toThrow('Job not found');
    expect([
      await count('candidates.person'),
      await count('candidates.outbox'),
      await count('intake.application'),
      await count('intake.application_source'),
      await count('intake.outbox'),
    ]).toEqual(before);
  });
});

describe('Scenario: There is no automatic rejection stage', () => {
  it('the database refuses a stage meaning rejected', async () => {
    const jobId = await newJob(w1, 'Backend Engineer');
    const { applicationId } = await as(ALEX, w1, (ctx) =>
      intake.receiveApplication(ctx, arrival(jobId, 'Paolo Garcia', 6, 'linkedin')),
    );
    await expect(
      withWorkspace(app, w1, (tx) =>
        tx.execute(sql`update intake.application set stage = 'rejected' where id = ${applicationId}`),
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'application_stage_check' });
  });
});

describe('Applications are isolated by workspace (ADR-005)', () => {
  // SAFETY: mutation check: ALTER POLICY application_tenant_isolation and application_source_tenant_isolation USING (true) WITH CHECK (true) -> this test and the next failed (saw both workspaces' rows)
  it('W1 sees only its own applications and sources even with no WHERE clause', async () => {
    const w2Job = await newJob(w2, 'Gulf job');
    await as(ALEX, w2, (ctx) => intake.receiveApplication(ctx, arrival(w2Job, 'Sneha Iyer', 1, 'linkedin')));
    const rows = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ workspace_id: string }>(
        sql`select workspace_id from intake.application union all select workspace_id from intake.application_source`,
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.workspace_id))).toEqual(new Set([w1]));
  });

  it('with no app.workspace_id set nothing is visible', async () => {
    expect([...(await app.execute(sql`select * from intake.application`))]).toEqual([]);
  });

  // SAFETY: mutation check: made the foreign key application_id -> application(id) only -> this test failed (the insert succeeded)
  it("a source cannot point at another workspace's application", async () => {
    const w2Job = await newJob(w2, 'Gulf job');
    const { applicationId } = await as(ALEX, w2, (ctx) =>
      intake.receiveApplication(ctx, arrival(w2Job, 'Anna Schmidt', 3, 'email')),
    );
    await expect(
      withWorkspace(app, w1, (tx) =>
        tx.execute(sql`insert into intake.application_source (id, workspace_id, application_id, source, received_at, file_ids, links)
          values (${crypto.randomUUID()}, ${w1}, ${applicationId}, 'email', now(), '{}', '{}')`),
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
});

describe('Authorisation (ADR-005 point 6)', () => {
  // SAFETY: mutation check: removed authorize(ctx, 'candidate.create') from receiveApplication -> this test failed (no ForbiddenError)
  it('an interviewer cannot record an application', async () => {
    const jobId = await newJob(w1, 'Interview job');
    await expect(
      as(LINA, w1, (ctx) => intake.receiveApplication(ctx, arrival(jobId, 'Mark Reyes', 7, 'email'))),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe('AIV-P1-086: listApplicationsForJob', () => {
  it('Scenario: Applicants appear right after adding them: one row each, with name, stage, received date and first source', async () => {
    const jobId = await newJob(w1, 'Senior Backend Engineer');
    const cast: [string, Source][] = [
      ['Sara Al Qahtani', 'linkedin'],
      ['Arjun Menon', 'referral'],
      ['Layla Haddad', 'email'],
    ];
    const expected = [];
    for (const [i, [name, source]] of cast.entries()) {
      const { applicationId, personId } = await as(ALEX, w1, (ctx) =>
        intake.receiveApplication(ctx, arrival(jobId, name, 200 + i, source)),
      );
      expected.unshift({ applicationId, personId, displayName: name, stage: 'new', receivedAt: NOW, source });
    }
    // A second arrival of Sara's CV adds a source, not a row, and her row keeps the first source.
    await as(ALEX, w1, (ctx) => intake.receiveApplication(ctx, arrival(jobId, 'Sara Al Qahtani', 200, 'whatsapp')));
    // Newest first.
    expect(await as(ALEX, w1, (ctx) => intake.listApplicationsForJob(ctx, jobId))).toEqual(expected);
  });

  it('a job with no applicants lists none', async () => {
    const jobId = await newJob(w1, 'Empty job');
    expect(await as(ALEX, w1, (ctx) => intake.listApplicationsForJob(ctx, jobId))).toEqual([]);
  });

  // SAFETY: mutation check: job-scope check removed -> this test failed (jobResource lookup and authorize dropped from listApplicationsForJob: Huda read Senior Backend Engineer's applicant, name included)
  it('Scenario: A hiring owner not granted this job is refused: Huda, granted only "Data Analyst"', async () => {
    const analyst = await newJob(w1, 'Data Analyst');
    const backend = await newJob(w1, 'Senior Backend Engineer');
    await as(ALEX, w1, (ctx) => workspaces.grantJobAccess(ctx, { userId: HUDA, jobId: analyst }));
    await as(ALEX, w1, (ctx) => intake.receiveApplication(ctx, arrival(analyst, 'Arjun Menon', 210, 'email')));
    await as(ALEX, w1, (ctx) => intake.receiveApplication(ctx, arrival(backend, 'Layla Haddad', 211, 'email')));
    const refused = as(HUDA, w1, (ctx) => intake.listApplicationsForJob(ctx, backend));
    await expect(refused).rejects.toThrow(IntakeError);
    await expect(refused).rejects.toThrow('Job not found');
    const own = await as(HUDA, w1, (ctx) => intake.listApplicationsForJob(ctx, analyst));
    expect(own.map((r) => r.displayName)).toEqual(['Arjun Menon']);
  });

  // SAFETY: mutation check: ALTER POLICY application_tenant_isolation ON intake.application USING (true) WITH CHECK (true) -> this test failed (W1 read W2's application); the job-scope mutation above also failed it (no "Job not found")
  it("Scenario: Another workspace cannot read the list, with the repository's workspace filter removed as well", async () => {
    const w2Job = await newJob(w2, 'Gulf job');
    await as(ALEX, w2, (ctx) => intake.receiveApplication(ctx, arrival(w2Job, 'Sara Al Qahtani', 220, 'linkedin')));
    await expect(as(ALEX, w1, (ctx) => intake.listApplicationsForJob(ctx, w2Job))).rejects.toThrow('Job not found');
    const seen = await withWorkspace(app, w1, (tx) =>
      tx.execute(sql`select id from intake.application where job_id = ${w2Job}`),
    );
    expect([...seen]).toEqual([]);
    const [all] = await admin.execute<{ n: number }>(
      sql`select count(*)::int as n from intake.application where job_id = ${w2Job}`,
    );
    expect(all?.n).toBe(1); // the row exists, so the empty read above is row-level security
  });
});

describe('AIV-P1-101: countApplications', () => {
  it('Scenario: The page for Senior AI Engineer: every source counts, and the careers page once per application', async () => {
    const sae = await newJob(w1, 'Senior AI Engineer');
    const other = await newJob(w1, 'Staff Backend Engineer');
    const empty = await newJob(w1, 'Empty job');
    await as(ALEX, w1, async (ctx) => {
      // Sara's CV twice through the careers page and once by email: one application, counted once.
      await intake.receiveApplication(ctx, arrival(sae, 'Sara Al Qahtani', 300, 'careers_page'));
      await intake.receiveApplication(ctx, arrival(sae, 'Sara Al Qahtani', 300, 'careers_page'));
      await intake.receiveApplication(ctx, arrival(sae, 'Sara Al Qahtani', 300, 'email'));
      // First by LinkedIn, then through the careers page: it came from the published listing too.
      await intake.receiveApplication(ctx, arrival(sae, 'Arjun Menon', 301, 'linkedin'));
      await intake.receiveApplication(ctx, arrival(sae, 'Arjun Menon', 301, 'careers_page'));
      await intake.receiveApplication(ctx, arrival(sae, 'Layla Haddad', 302, 'referral'));
      // Another job's applications are not this job's.
      await intake.receiveApplication(ctx, arrival(other, 'Daniel Novak', 303, 'careers_page'));
    });
    expect(await as(ALEX, w1, (ctx) => intake.countApplications(ctx, sae))).toEqual({ total: 3, careersPage: 2 });
    expect(await as(ALEX, w1, (ctx) => intake.countApplications(ctx, other))).toEqual({ total: 1, careersPage: 1 });
    expect(await as(ALEX, w1, (ctx) => intake.countApplications(ctx, empty))).toEqual({ total: 0, careersPage: 0 });
  });

  // SAFETY: mutation check: jobResource lookup and authorize dropped from countApplications -> this test failed (Huda counted the ungranted job)
  it('a hiring owner not granted the job is refused, and counts the job she is granted', async () => {
    const analyst = await newJob(w1, 'Data Analyst');
    const backend = await newJob(w1, 'Senior Backend Engineer');
    await as(ALEX, w1, (ctx) => workspaces.grantJobAccess(ctx, { userId: HUDA, jobId: analyst }));
    await as(ALEX, w1, (ctx) => intake.receiveApplication(ctx, arrival(analyst, 'Arjun Menon', 310, 'careers_page')));
    await as(ALEX, w1, (ctx) => intake.receiveApplication(ctx, arrival(backend, 'Layla Haddad', 311, 'email')));
    await expect(as(HUDA, w1, (ctx) => intake.countApplications(ctx, backend))).rejects.toThrow('Job not found');
    expect(await as(HUDA, w1, (ctx) => intake.countApplications(ctx, analyst))).toEqual({ total: 1, careersPage: 1 });
  });

  // SAFETY: mutation check: ALTER POLICY application_tenant_isolation and application_source_tenant_isolation USING (true) WITH CHECK (true) -> this test failed (the unfiltered count in W1 saw W2's application); the job-scope mutation above failed it too (no "Job not found")
  it("Scenario: Another workspace's job: refused, and row-level security hides its applications from the count", async () => {
    const w2Job = await newJob(w2, 'Gulf job');
    await as(ALEX, w2, (ctx) => intake.receiveApplication(ctx, arrival(w2Job, 'Sara Al Qahtani', 320, 'careers_page')));
    await expect(as(ALEX, w1, (ctx) => intake.countApplications(ctx, w2Job))).rejects.toThrow('Job not found');
    // The count's query with the repository's workspace filter removed, inside W1: row-level security alone hides it.
    const [seen] = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ n: number }>(sql`select count(distinct a.id)::int as n from intake.application a
        join intake.application_source s on s.application_id = a.id where a.job_id = ${w2Job}`),
    );
    expect(seen?.n).toBe(0);
    expect(await as(ALEX, w2, (ctx) => intake.countApplications(ctx, w2Job))).toEqual({ total: 1, careersPage: 1 });
  });
});

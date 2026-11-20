import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createAudit } from '@aivera/audit/composition';
import { CandidateError } from '@aivera/candidates';
import { createCandidates } from '@aivera/candidates/composition';
import { createDb, type Db } from '@aivera/db';
import { JobError } from '@aivera/jobs';
import { createJobs } from '@aivera/jobs/composition';
import { seedDemo, SEED_ISSUER } from '@aivera/seed';
import { WorkspaceError } from '@aivera/workspaces';
import { createWorkspaces } from '@aivera/workspaces/composition';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P0-031 acceptance scenarios against real PostgreSQL. The seed connects as the non-owner aivera_app role, as
// `pnpm db:seed` does; `admin` (the container's superuser) reads every row past row-level security to check.

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@aivera/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');
const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1';

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

/** Every row the seed can write, in a stable order, to compare runs. */
const snapshot = async () => {
  const tables = [
    'identity.user',
    'identity.sign_in_method',
    'workspaces.workspace',
    'workspaces.member',
    'workspaces.active_workspace',
    'workspaces.job_grant',
    'candidates.person',
    'candidates.person_identifier',
    'jobs.job',
    'jobs.rubric_version',
    'jobs.competency',
    'jobs.public_job',
    'audit.entry',
  ];
  const rows: Record<string, unknown[]> = {};
  for (const t of tables)
    rows[t] = [...(await admin.execute(sql.raw(`select to_jsonb(t) as r from ${t} t order by to_jsonb(t)::text`)))];
  return rows;
};

const count = async (query: SQL) => Number((await admin.execute<{ n: string }>(query))[0]?.n);

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 2 });
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

describe('Scenario: Production is refused', () => {
  it.each(['prod', 'pilot', 'production', undefined])('APP_ENV %s writes nothing', async (appEnv) => {
    const before = await snapshot();
    await expect(seedDemo(app, { appEnv })).rejects.toThrow('Seeding is not allowed in production');
    expect(await snapshot()).toEqual(before);
  });

  it('the CLI exits non-zero with the message', () => {
    const cli = join(import.meta.dirname, '..', '..', '..', 'tools', 'seed', 'src', 'cli.ts');
    try {
      execFileSync(process.execPath, [cli], {
        env: { ...process.env, APP_ENV: 'prod', DATABASE_URL: urlFor('aivera_app') },
        stdio: 'pipe',
      });
      expect.unreachable();
    } catch (error) {
      expect((error as { status: number }).status).toBe(1);
      expect(String((error as { stderr: Buffer }).stderr)).toContain('Seeding is not allowed in production');
    }
  });
});

describe('Scenario: Seeding a fresh database', () => {
  let workspaceId: string;
  beforeAll(async () => {
    workspaceId = await seedDemo(app, { appEnv: 'local' });
  });

  it('creates a synthetic workspace with recruiter AP as admin and 5 hiring owners', async () => {
    const [ws] = await admin.execute<{ name: string; synthetic: boolean }>(
      sql`select name, synthetic from workspaces.workspace where id = ${workspaceId}`,
    );
    expect(ws).toEqual({ name: 'Demo', synthetic: true });
    const members = await admin.execute<{ role: string; email: string; status: string }>(sql`
      select m.role, u.email, m.status from workspaces.member m join identity.user u on u.id = m.user_id
      where m.workspace_id = ${workspaceId} order by m.role, u.email`);
    expect([...members]).toEqual([
      { role: 'admin', email: 'ap@example.com', status: 'active' },
      ...['cpo.payments', 'design.director', 'head.engineering', 'head.quality', 'vp.engineering'].map((k) => ({
        role: 'hiring_owner',
        email: `${k}@example.com`,
        status: 'active',
      })),
    ]);
  });

  it('every person is synthetic and on example.com, and Sara is among the 23 candidates', async () => {
    const people = await admin.execute<{ display_name: string; synthetic: boolean; emails: string[] }>(
      sql`select display_name, synthetic, emails from candidates.person where workspace_id = ${workspaceId}`,
    );
    expect(people).toHaveLength(23);
    expect(people.map((p) => p.display_name)).toEqual(
      expect.arrayContaining(['Sara Al Qahtani', 'Arjun Menon', 'Layla Haddad', 'Daniel Novak']),
    );
    for (const p of people) {
      expect(p.synthetic).toBe(true);
      expect(p.emails.every((e) => e.endsWith('@example.com'))).toBe(true);
    }
    const users = await admin.execute<{ email: string }>(sql`
      select u.email from identity.user u join identity.sign_in_method s on s.user_id = u.id
      where s.issuer = ${SEED_ISSUER}`);
    expect(users).toHaveLength(6);
    expect(users.every((u) => u.email.endsWith('@example.com'))).toBe(true);
  });

  it('audits the workspace and every added member', async () => {
    const actions = await admin.execute<{ action: string; n: string }>(sql`
      select action, count(*) as n from audit.entry where workspace_id = ${workspaceId} group by action order by action`);
    expect([...actions]).toEqual([
      { action: 'job_access.granted', n: '5' },
      { action: 'job.created', n: '5' },
      { action: 'member.added', n: '5' },
      { action: 'workspace.created', n: '1' },
    ]);
  });

  // AIV-P1-065. The design jobs stay in the cast as they are (cast.test.ts snapshot); the seed writes the industry jobs.
  type Row = { title: string; synthetic: boolean; stage: string; version: number; status: string };
  const jobsOf = () =>
    admin.execute<Row>(sql`select j.title, j.synthetic, j.stage, v.version, v.status from jobs.job j
      join jobs.rubric_version v on v.job_id = j.id where j.workspace_id = ${workspaceId} order by j.title collate "C"`);
  const competenciesOf = (title: string) =>
    admin.execute<{
      name: string;
      origin: string;
      pack_key: string | null;
      pack_version: number | null;
      type: string;
      weight_percent: number;
      level_needed: number;
    }>(sql`select c.name, c.origin, c.pack_key, c.pack_version, c.type, c.weight_percent, c.level_needed
      from jobs.competency c join jobs.rubric_version v on v.id = c.rubric_version_id
      join jobs.job j on j.id = v.job_id where j.workspace_id = ${workspaceId} and j.title = ${title}
      order by c.position`);

  describe('Scenario: Five industry jobs are seeded', () => {
    it('adds the five industry jobs, each synthetic with a draft rubric v1 at "Defining rubric"', async () => {
      expect([...(await jobsOf())]).toEqual(
        [
          'Data Engineer, Marketplace',
          'Integration Engineer, Health Records',
          'QA Engineer, Payments',
          'SRE, Core Banking',
          'Senior Backend Engineer, Payments',
        ].map((title) => ({ title, synthetic: true, stage: 'defining_rubric', version: 1, status: 'draft' })),
      );
      expect(await competenciesOf('Senior Backend Engineer, Payments')).toContainEqual(
        expect.objectContaining({
          name: 'Idempotent payment APIs and retries',
          origin: 'domain_pack',
          pack_key: 'payments_fintech',
          pack_version: 1,
        }),
      );
    });

    it("grants each job's hiring owner, who is job-scoped, the job whose draft they approve", async () => {
      const workspaces = createWorkspaces(app, createAudit(app));
      const jobs = createJobs(workspaces, createAudit(app));
      const [vp] = await admin.execute<{ id: string }>(
        sql`select id from identity.user where email = 'vp.engineering@example.com'`,
      );
      if (!vp) throw new Error('the seed created VP Engineering');
      const seen = await workspaces.withWorkspace({ userId: vp.id }, workspaceId, (ctx) => jobs.listJobs(ctx));
      expect(seen.map((j) => j.title).toSorted()).toEqual([
        'Data Engineer, Marketplace',
        'SRE, Core Banking',
        'Senior Backend Engineer, Payments',
      ]);
    });

    // Scenario Outline: Each industry job uses its pack and region.
    it.each([
      ['Integration Engineer, Health Records', 'healthcare', 'DHA NABIDH health information exchange'],
      ['Data Engineer, Marketplace', 'ecommerce_marketplaces', 'ZATCA e-invoicing (Fatoora)'],
      ['SRE, Core Banking', 'banking_islamic_finance', 'SAMA cyber security framework'],
      ['QA Engineer, Payments', 'payments_fintech', 'UPI and NPCI rules'],
    ])('%s has competencies from pack %s and the regional hint "%s"', async (title, pack, hint) => {
      const rows = await competenciesOf(title);
      const packed = rows.filter((c) => c.origin === 'domain_pack');
      expect(packed.length).toBeGreaterThan(1);
      expect(packed.every((c) => c.pack_key === pack && c.pack_version === 1)).toBe(true);
      expect(packed.map((c) => c.name)).toContain(hint);
    });

    it('Scenario: Rubrics are valid drafts: weights total 100, levels 1 to 5, every regional hint desirable', async () => {
      for (const { title } of await jobsOf()) {
        const rows = await competenciesOf(title);
        expect(
          rows.reduce((sum, c) => sum + c.weight_percent, 0),
          title,
        ).toBe(100);
        for (const c of rows) expect(c.level_needed >= 1 && c.level_needed <= 5, c.name).toBe(true);
        for (const c of rows.filter((r) => r.origin === 'domain_pack')) expect(c.type, c.name).toBe('desirable');
      }
    });
  });

  describe('Scenario: The seed is idempotent', () => {
    it('a second run adds and changes no row', async () => {
      const before = await snapshot();
      expect(await seedDemo(app, { appEnv: 'local' })).toBe(workspaceId);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('Scenario: Reset only touches synthetic workspaces', () => {
    it('drops and reseeds the synthetic workspace and leaves a real one untouched', async () => {
      const workspaces = createWorkspaces(app, createAudit(app));
      const real = await workspaces.createWorkspace({
        name: 'Demo Hiring Co',
        company: 'Demo Hiring Co',
        hiringFocus: 'ai_llm_engineering',
        creatorUserId: ALEX,
      });
      const realRows = () =>
        count(sql`select count(*) as n from workspaces.workspace w join workspaces.member m on m.workspace_id = w.id
          where w.id = ${real.id} and not w.synthetic`);
      expect(await realRows()).toBe(1);

      const reseeded = await seedDemo(app, { appEnv: 'local', reset: true });
      expect(reseeded).not.toBe(workspaceId);
      const left = (table: string) =>
        count(sql`select count(*) as n from ${sql.raw(table)} where workspace_id = ${workspaceId}`);
      expect(await count(sql`select count(*) as n from workspaces.workspace where id = ${workspaceId}`)).toBe(0);
      for (const t of [
        'workspaces.member',
        'workspaces.job_grant',
        'candidates.person',
        'candidates.person_identifier',
        'jobs.job',
        'jobs.rubric_version',
        'jobs.competency',
      ])
        expect(await left(t)).toBe(0);
      expect(await count(sql`select count(*) as n from candidates.person where workspace_id = ${reseeded}`)).toBe(23);
      expect(await count(sql`select count(*) as n from jobs.job where workspace_id = ${reseeded}`)).toBe(5);
      // The append-only log keeps the old workspace's entries and records the purge last.
      const [last] = await admin.execute<{ action: string }>(
        sql`select action from audit.entry where workspace_id = ${workspaceId} order by seq desc limit 1`,
      );
      expect(last?.action).toBe('workspace.purged');
      // The outbox keeps them too (ids only; aivera_app cannot delete events): consumers accept a person that is gone (AIV-P0-015).
      expect(await left('candidates.outbox')).toBe(23);
      expect(await realRows()).toBe(1);
    });

    // SAFETY: mutation check: removed the synthetic check in lockSynthetic (synthetic.ts) -> this test failed (resolved)
    it('the purge refuses a workspace not flagged synthetic, deleting nothing', async () => {
      const workspaces = createWorkspaces(app, createAudit(app));
      const real = await workspaces.createWorkspace({
        name: 'Gulf Talent Partners',
        company: 'Gulf Talent Partners',
        hiringFocus: 'several',
        creatorUserId: ALEX,
      });
      await expect(
        workspaces.withWorkspace({ userId: ALEX }, real.id, (ctx) => workspaces.purgeSyntheticWorkspace(ctx)),
      ).rejects.toThrow(WorkspaceError);
      await expect(
        workspaces.withWorkspace({ userId: ALEX }, real.id, (ctx) => workspaces.addSyntheticMember(ctx, ALEX, 'admin')),
      ).rejects.toThrow(WorkspaceError);
      expect(await count(sql`select count(*) as n from workspaces.workspace where id = ${real.id}`)).toBe(1);
    });

    // SAFETY: mutation check: removed the isSyntheticWorkspace check in purgeSyntheticPeople -> this test failed (resolved)
    it('the candidates purge refuses a workspace not flagged synthetic, even when everyone in it is', async () => {
      const workspaces = createWorkspaces(app, createAudit(app));
      const candidates = createCandidates(workspaces);
      const real = await workspaces.createWorkspace({
        name: 'Nadia Freelance',
        company: 'Nadia Freelance',
        hiringFocus: 'several',
        creatorUserId: ALEX,
      });
      await workspaces.withWorkspace({ userId: ALEX }, real.id, (ctx) =>
        candidates.findOrCreatePerson(ctx, {
          displayName: 'Hala Saleh',
          identifiers: [{ type: 'email', value: 'hala.saleh@example.com' }],
          synthetic: true,
        }),
      );
      await expect(
        workspaces.withWorkspace({ userId: ALEX }, real.id, (ctx) => candidates.purgeSyntheticPeople(ctx)),
      ).rejects.toThrow(CandidateError);
      expect(await count(sql`select count(*) as n from candidates.person where workspace_id = ${real.id}`)).toBe(1);
    });

    // SAFETY: mutation check: removed the isSyntheticWorkspace check in purgeSyntheticJobs -> this test failed (resolved)
    it('the jobs purge refuses a workspace not flagged synthetic, even when every job in it is', async () => {
      const workspaces = createWorkspaces(app, createAudit(app));
      const jobs = createJobs(workspaces, createAudit(app));
      const real = await workspaces.createWorkspace({
        name: 'Omar Agency',
        company: 'Omar Agency',
        hiringFocus: 'several',
        creatorUserId: ALEX,
      });
      await workspaces.withWorkspace({ userId: ALEX }, real.id, (ctx) =>
        jobs.createJob(ctx, {
          title: 'SRE, Core Banking',
          jobType: 'devops_sre',
          description: 'A retail bank is hiring.',
          synthetic: true,
        }),
      );
      await expect(
        workspaces.withWorkspace({ userId: ALEX }, real.id, (ctx) => jobs.purgeSyntheticJobs(ctx)),
      ).rejects.toThrow(JobError);
      expect(await count(sql`select count(*) as n from jobs.job where workspace_id = ${real.id}`)).toBe(1);
    });

    // SAFETY: mutation check: removed the synthetic = false lookup in deleteSyntheticJobs -> this test failed (resolved)
    it('reset refuses a demo workspace holding a job not synthetic and deletes nothing', async () => {
      const workspaces = createWorkspaces(app, createAudit(app));
      const jobs = createJobs(workspaces, createAudit(app));
      const demo = await seedDemo(app, { appEnv: 'local' });
      const [ap] = await admin.execute<{ id: string }>(
        sql`select id from identity.user where email = 'ap@example.com'`,
      );
      if (!ap) throw new Error('the seed above created AP');
      await workspaces.withWorkspace({ userId: ap.id }, demo, (ctx) =>
        jobs.createJob(ctx, { title: 'Imported job', jobType: 'sales', description: 'Imported.', synthetic: false }),
      );
      const before = await snapshot();
      await expect(seedDemo(app, { appEnv: 'local', reset: true })).rejects.toThrow(JobError);
      expect(await snapshot()).toEqual(before);
    });

    // Last: it leaves a person who is not synthetic in the demo workspace (and the job above), and the candidates
    // purge runs first.
    // SAFETY: mutation check: removed the synthetic = false lookup in deleteSyntheticPeople -> this test failed (resolved)
    it('reset refuses a demo workspace holding anyone not synthetic and deletes nothing', async () => {
      const workspaces = createWorkspaces(app, createAudit(app));
      const candidates = createCandidates(workspaces);
      const [ap] = await admin.execute<{ id: string }>(
        sql`select id from identity.user where email = 'ap@example.com'`,
      );
      if (!ap) throw new Error('the seed above created AP');
      const demo = await seedDemo(app, { appEnv: 'local' });
      await workspaces.withWorkspace({ userId: ap.id }, demo, (ctx) =>
        candidates.findOrCreatePerson(ctx, {
          displayName: 'Imported person',
          identifiers: [{ type: 'email', value: 'imported@example.com' }],
          synthetic: false,
        }),
      );
      const before = await snapshot();
      await expect(seedDemo(app, { appEnv: 'local', reset: true })).rejects.toThrow(CandidateError);
      expect(await snapshot()).toEqual(before);
    });
  });
});

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createAudit } from '@credalent/audit/composition';
import { CandidateError } from '@credalent/candidates';
import { createCandidates } from '@credalent/candidates/composition';
import { createDb, type Db } from '@credalent/db';
import { JobError } from '@credalent/jobs';
import { createJobs } from '@credalent/jobs/composition';
import { seedDemo, SEED_ISSUER } from '@credalent/seed';
import { CANDIDATES, INDUSTRY_JOBS } from '@credalent/seed/cast';
import { WorkspaceError } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P0-031 acceptance scenarios against real PostgreSQL. The seed connects as the non-owner aivera_app role, as
// `pnpm db:seed` does; `admin` (the container's superuser) reads every row past row-level security to check.

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
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
    'jobs.outbox',
    'evidence.source',
    'evidence.item',
    'evidence.outbox',
    'audit.entry',
  ];
  const rows: Record<string, unknown[]> = {};
  for (const t of tables)
    rows[t] = [...(await admin.execute(sql.raw(`select to_jsonb(t) as r from ${t} t order by to_jsonb(t)::text`)))];
  return rows;
};

const count = async (query: SQL) => Number((await admin.execute<{ n: string }>(query))[0]?.n);

/** The workspace's jobs and rubric versions without ids or creation times, to compare a reseed with the seed. */
const facts = (id: string) =>
  admin.execute(sql`select j.title, j.stage, j.synthetic, v.version, v.status, v.approved_at, v.change_note,
      v.success_statement from jobs.job j join jobs.rubric_version v on v.job_id = j.id
      where j.workspace_id = ${id} order by j.title, v.version`);
/** Every row of `id` across the seeded tables, to show a seed leaves another workspace alone. */
const rowsOf = async (id: string) =>
  Object.fromEntries(
    Object.entries(await snapshot()).map(([t, rows]) => [
      t,
      rows.filter((r) => (r as { r: { workspace_id?: string } }).r.workspace_id === id),
    ]),
  );

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

  it("AIV-P1-024: records Sara's, Arjun's and Layla's evidence, every source and item synthetic", async () => {
    const rows = await admin.execute<{ name: string; items: string; strong: string; synthetic: boolean }>(sql`
      select p.display_name as name, count(*) as items, count(*) filter (where i.strength = 'strong') as strong,
        bool_and(i.synthetic and s.synthetic) as synthetic
      from evidence.item i join evidence.source s on s.id = i.source_id join candidates.person p on p.id = i.candidate_id
      where i.workspace_id = ${workspaceId} group by p.display_name order by p.display_name`);
    expect([...rows]).toEqual([
      { name: 'Arjun Menon', items: '5', strong: '2', synthetic: true },
      { name: 'Layla Haddad', items: '5', strong: '2', synthetic: true },
      { name: 'Sara Al Qahtani', items: '6', strong: '2', synthetic: true },
    ]);
    const [source] = await admin.execute<{ check_method: string; checked: string }>(sql`select check_method,
      to_char(checked_at at time zone 'UTC', 'YYYY-MM-DD') as checked from evidence.source
      where workspace_id = ${workspaceId} and label = 'llm-eval-harness'`);
    expect(source).toEqual({ check_method: 'Commit history', checked: '2026-11-12' });
  });

  it('audits the workspace and every added member', async () => {
    const actions = await admin.execute<{ action: string; n: string }>(sql`
      select action, count(*) as n from audit.entry where workspace_id = ${workspaceId} group by action order by action`);
    expect([...actions]).toEqual([
      { action: 'job_access.granted', n: '10' },
      { action: 'job.created', n: '10' },
      { action: 'job.stage_changed', n: '4' },
      { action: 'member.added', n: '5' },
      { action: 'rubric.approved', n: '5' },
      { action: 'rubric.saved', n: '6' },
      { action: 'rubric.submitted', n: '5' },
      { action: 'workspace.created', n: '1' },
    ]);
  });

  // AIV-P1-065: the industry jobs.
  type Row = { title: string; synthetic: boolean; stage: string; version: number; status: string };
  const industryTitles = INDUSTRY_JOBS.map((j) => j.title);
  const jobsOf = () =>
    admin.execute<Row>(sql`select j.title, j.synthetic, j.stage, v.version, v.status from jobs.job j
      join jobs.rubric_version v on v.job_id = j.id where j.workspace_id = ${workspaceId}
      and j.title in ${industryTitles} order by j.title collate "C"`);
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
        'Staff Backend Engineer',
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

  // AIV-P1-067: the design jobs, each rubric version with its approval and approver.
  const versionsOf = (title: string) =>
    admin.execute<{
      stage: string;
      version: number;
      status: string;
      approved_on: string | null;
      approver: string | null;
    }>(
      sql`select j.stage, v.version, v.status, to_char(v.approved_at, 'YYYY-MM-DD') as approved_on, u.display_name as approver
      from jobs.job j join jobs.rubric_version v on v.job_id = j.id left join identity.user u on u.id = v.approved_by
      where j.workspace_id = ${workspaceId} and j.title = ${title} order by v.version`,
    );

  describe('Scenario Outline: Design jobs are seeded at their stages and rubric versions', () => {
    it.each([
      ['Senior AI Engineer', 'round_1', 2, '2026-11-12', 'Head of Engineering'],
      ['Senior Product Manager, Payments', 'round_1', 1, '2026-11-05', 'CPO, Payments'],
      ['QA Automation Engineer', 'collecting_evidence', 1, '2026-11-09', 'Head of Quality'],
      ['Staff Backend Engineer', 'collecting_evidence', 1, '2026-11-10', 'VP Engineering'],
    ])('%s is at %s, rubric v%i approved on %s by %s', async (title, stage, version, approvedOn, owner) => {
      expect((await versionsOf(title)).at(-1)).toEqual({
        stage,
        version,
        status: 'approved',
        approved_on: approvedOn,
        approver: owner,
      });
      // Of the design jobs, the owner is granted this one only (VP Engineering and Head of Engineering also own
      // industry jobs, AIV-P1-065).
      const granted = await admin.execute<{ title: string }>(sql`select j.title from workspaces.job_grant g
        join identity.user u on u.id = g.user_id join jobs.job j on j.id = g.job_id
        where g.workspace_id = ${workspaceId} and u.display_name = ${owner} and j.title not in ${industryTitles}`);
      expect(granted.map((g) => g.title)).toEqual([title]);
    });
  });

  it('Scenario: The designer job stays a draft, and the Senior AI Engineer version 1 is superseded', async () => {
    expect([...(await versionsOf('Senior Product Designer'))]).toEqual([
      { stage: 'defining_rubric', version: 1, status: 'draft', approved_on: null, approver: null },
    ]);
    expect((await versionsOf('Senior AI Engineer'))[0]).toMatchObject({
      version: 1,
      status: 'superseded',
      approved_on: '2026-11-05',
    });
  });

  it('every design rubric reads as the artboards do: evidence expected, level, type and a success statement', async () => {
    const empty = await admin.execute(sql`select c.name from jobs.competency c
      join jobs.rubric_version v on v.id = c.rubric_version_id join jobs.job j on j.id = v.job_id
      where j.workspace_id = ${workspaceId} and j.title not in ${industryTitles}
      and (btrim(c.evidence_expected) = '' or btrim(v.success_statement) = '')`);
    expect([...empty]).toEqual([]);
    // The Rubric artboard: version 2 with its change note, two rows suggested by Credalent, Arabic NLP desirable.
    const [v2] = await admin.execute<{ change_note: string; success_statement: string }>(sql`select v.change_note,
      v.success_statement from jobs.rubric_version v join jobs.job j on j.id = v.job_id
      where j.workspace_id = ${workspaceId} and j.title = 'Senior AI Engineer' and v.version = 2`);
    expect(v2?.change_note).toBe('Product judgement raised from 10% to 15%; Arabic NLP changed to desirable.');
    expect(v2?.success_statement).toMatch(/^Within six months, a bilingual assistant/);
    const rows = await admin.execute(sql`select c.name, c.weight_percent, c.level_needed, c.type, c.origin
      from jobs.competency c join jobs.rubric_version v on v.id = c.rubric_version_id join jobs.job j on j.id = v.job_id
      where j.workspace_id = ${workspaceId} and j.title = 'Senior AI Engineer' and v.version = 2 order by c.position`);
    expect([...rows]).toEqual(
      [
        ['LLM systems in production', 25, 4, 'mandatory', 'from_description'],
        ['Retrieval and evaluation', 20, 4, 'mandatory', 'from_description'],
        ['Python service engineering', 15, 3, 'mandatory', 'from_description'],
        ['Cost and reliability', 15, 2, 'desirable', 'from_description'],
        ['Arabic and bilingual NLP', 10, 2, 'desirable', 'suggested_by_aivera'],
        ['Product judgement', 15, 3, 'mandatory', 'suggested_by_aivera'],
      ].map(([name, weight_percent, level_needed, type, origin]) => ({
        name,
        weight_percent,
        level_needed,
        type,
        origin,
      })),
    );
  });

  it('Scenario: Every approval is audited as a person decision, with no candidate value', async () => {
    const approvals = await admin.execute<{ version_id: string; approved_at: Date; approver: string }>(
      sql`select v.id as version_id, v.approved_at, v.approved_by as approver from jobs.rubric_version v
      where v.workspace_id = ${workspaceId} and v.approved_at is not null`,
    );
    expect(approvals).toHaveLength(5);
    for (const v of approvals) {
      const entries = await admin.execute<{ actor_type: string; actor_id: string; occurred_at: Date; before: unknown }>(
        sql`select actor_type, actor_id, occurred_at, before from audit.entry
        where action = 'rubric.approved' and subject_id = ${v.version_id}`,
      );
      // One entry: the job's hiring owner, at the approval time, and why it moved: it was awaiting their approval.
      expect([...entries]).toEqual([
        {
          actor_type: 'user',
          actor_id: v.approver,
          occurred_at: v.approved_at,
          before: expect.objectContaining({ status: 'awaiting_approval' }),
        },
      ]);
    }
    const log = JSON.stringify([
      ...(await admin.execute(sql`select * from audit.entry where workspace_id = ${workspaceId}`)),
    ]).toLowerCase();
    for (const c of CANDIDATES)
      for (const value of [c.displayName, c.email, c.phone]) expect(log).not.toContain(value.toLowerCase());
  });

  describe('Scenario: The seed is idempotent', () => {
    it('a second run adds and changes no row', async () => {
      const before = await snapshot();
      expect(await seedDemo(app, { appEnv: 'local' })).toBe(workspaceId);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('Scenario: Reset only touches synthetic workspaces', () => {
    // AIV-P1-067: the demo holds approved and superseded rubric versions by now; reset deletes them too.
    it('drops and reseeds the synthetic workspace and leaves a real one untouched', async () => {
      const seeded = [...(await facts(workspaceId))];
      expect(seeded.some((f) => f['status'] === 'superseded')).toBe(true);
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
      const realBefore = await rowsOf(real.id);

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
        'evidence.source',
        'evidence.item',
      ])
        expect(await left(t)).toBe(0);
      expect(await count(sql`select count(*) as n from candidates.person where workspace_id = ${reseeded}`)).toBe(23);
      expect(await count(sql`select count(*) as n from jobs.job where workspace_id = ${reseeded}`)).toBe(10);
      expect(await count(sql`select count(*) as n from evidence.item where workspace_id = ${reseeded}`)).toBe(16);
      expect([...(await facts(reseeded))]).toEqual(seeded);
      // The append-only log keeps the old workspace's entries and records the purge last.
      const [last] = await admin.execute<{ action: string }>(
        sql`select action from audit.entry where workspace_id = ${workspaceId} order by seq desc limit 1`,
      );
      expect(last?.action).toBe('workspace.purged');
      // The outbox keeps them too (ids only; aivera_app cannot delete events): consumers accept a person that is gone (AIV-P0-015).
      expect(await left('candidates.outbox')).toBe(23);
      expect(await realRows()).toBe(1);
      expect(await rowsOf(real.id)).toEqual(realBefore);
    });

    // SAFETY: mutation check: dropped "AND synthetic" from refuse_approved_version_change and
    // refuse_approved_competency_change -> this test failed (the deletes went through); dropped trigger
    // job_synthetic_frozen_check -> this test failed (the flag flipped, then the delete went through)
    it("a real job's approved rubric version can never be deleted, even with the repository filter removed", async () => {
      const workspaces = createWorkspaces(app, createAudit(app));
      const jobs = createJobs(workspaces, createAudit(app));
      const real = await workspaces.createWorkspace({
        name: 'Real Hiring Co',
        company: 'Real Hiring Co',
        hiringFocus: 'several',
        creatorUserId: ALEX,
      });
      const versionId = await workspaces.withWorkspace({ userId: ALEX }, real.id, async (ctx) => {
        const { rubricVersion } = await jobs.createJobWithDraftRubric(ctx, {
          title: 'Imported job',
          jobType: 'sales',
          description: 'Imported.',
          synthetic: false,
          competencies: [
            {
              name: 'Delivery',
              evidenceExpected: '',
              weightPercent: 100,
              levelNeeded: 3,
              type: 'mandatory',
              origin: 'from_description',
            },
          ],
        });
        await jobs.submitRubric(ctx, rubricVersion.id);
        await jobs.approveRubric(ctx, rubricVersion.id);
        return rubricVersion.id;
      });
      // Raw deletes in the workspace's own scope: no repository, only row-level security and the triggers.
      const deleting = (statement: SQL) =>
        workspaces.withWorkspace({ userId: ALEX }, real.id, (ctx) => ctx.tx.execute(statement));
      await expect(
        deleting(sql`delete from jobs.competency where rubric_version_id = ${versionId}`),
      ).rejects.toMatchObject({ code: '23514', constraint: 'competency_version_frozen_check' });
      await expect(deleting(sql`delete from jobs.rubric_version where id = ${versionId}`)).rejects.toMatchObject({
        code: '23514',
        constraint: 'rubric_version_frozen_check',
      });
      // Nor by flagging the job synthetic first: the flag is fixed when the job is created.
      await expect(
        deleting(sql`update jobs.job set synthetic = true where id in
          (select job_id from jobs.rubric_version where id = ${versionId})`),
      ).rejects.toMatchObject({ code: '23514', constraint: 'job_synthetic_frozen_check' });
      expect(await count(sql`select count(*) as n from jobs.rubric_version where id = ${versionId}`)).toBe(1);
      expect(await count(sql`select count(*) as n from jobs.competency where rubric_version_id = ${versionId}`)).toBe(
        1,
      );
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

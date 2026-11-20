import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createAudit } from '@credalent/audit/composition';
import { createDb, type Db } from '@credalent/db';
import { JobError, type Competency, type JobsContract } from '@credalent/jobs';
import { createCatalogueReads, createJobs } from '@credalent/jobs/composition';
import type { WorkspaceContext, WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P2-043: the catalogue tables and published version 1 (ADR-013), on real PostgreSQL. AIV-P2-044: readers take the
// latest published version, and the jobs module validates keys against it.

const repo = join(import.meta.dirname, '..', '..', '..');
const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(repo, 'packages', 'db', 'src', 'cli.ts');
const seedSql = readFileSync(
  join(repo, 'modules', 'jobs', 'src', 'infrastructure', 'migrations', '0017_catalogue_v1_seed.sql'),
  'utf8',
);
// The snapshot generated from the code catalogue before AIV-P2-044 deleted it; the seed migration is written from it.
const snapshot: unknown = JSON.parse(
  readFileSync(join(repo, 'modules', 'jobs', 'src', 'infrastructure', 'catalogue-v1.json'), 'utf8'),
);

const TABLES = [
  'catalogue_version',
  'catalogue_job_type',
  'catalogue_region',
  'catalogue_pack',
  'catalogue_pack_competency',
  'catalogue_regional_hint',
];

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let migrator: Db;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
const migrate = () =>
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });

const pgError = (promise: Promise<unknown>) =>
  promise.then(
    () => ({ code: 'none', constraint: undefined }),
    (error: { code?: string; constraint?: string; cause?: unknown }) => {
      const pg = (error.cause ?? error) as { code?: string; constraint_name?: string };
      return { code: error.code ?? pg.code, constraint: error.constraint ?? pg.constraint_name };
    },
  );

const counts = async () =>
  Object.fromEntries(
    await Promise.all(
      TABLES.map(async (t) => {
        const [row] = await admin.execute<{ n: number }>(
          sql`select count(*)::int as n from ${sql.identifier('jobs')}.${sql.identifier(t)}`,
        );
        return [t, row?.n];
      }),
    ),
  );

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  migrate();
  app = createDb(urlFor('aivera_app'), { max: 1 });
  migrator = createDb(urlFor('aivera_migrator'), { max: 1 });
});

afterAll(async () => {
  await Promise.all([app?.$client.end(), migrator?.$client.end(), admin?.$client.end()]);
  await container?.stop();
});

describe('Feature: Catalogue tables seeded with version 1', () => {
  // The drift test (AIV-P2-044): the snapshot the AI evals and unit tests read is what the database publishes.
  // SAFETY: mutation check: renamed one competency in catalogue-v1.json -> this test failed
  it('Scenario: Version 1 equals the committed snapshot of the code catalogue', async () => {
    const catalogue = await createCatalogueReads(app).getPublishedCatalogue();
    expect(catalogue).toEqual({
      ...(snapshot as object),
      status: 'published',
      publishedAt: expect.any(Date),
      publishedBy: 'system:seed',
      reason: 'Catalogue version 1 from code (AIV-P1-004, AIV-P1-061)',
    });
    // The snapshot really reaches every entry, so an empty catalogue on both sides cannot pass.
    expect(catalogue.jobTypes).toHaveLength(10);
    expect(catalogue.packs).toHaveLength(8);
    expect(catalogue.packs.every((p) => p.competencies.length > 0 && p.hints.length > 0)).toBe(true);
  });

  it('version 1 has at most 4 core competencies per job type per pack (the rule the editor enforces)', async () => {
    const over = await admin.execute(sql`select pack_key, job_type, count(*) from jobs.catalogue_pack_competency,
        unnest(core) as job_type where version = 1 group by pack_key, job_type having count(*) > 4`);
    expect([...over]).toEqual([]);
  });

  it('Scenario: The seed is idempotent', async () => {
    const before = await counts();
    expect(before['catalogue_version']).toBe(1);
    migrate();
    // The migrator's journal skips an applied migration, so the seed's own SQL is run again as well.
    await migrator.$client.unsafe(seedSql);
    expect(await counts()).toEqual(before);
  });

  describe('Scenario: Published rows are immutable', () => {
    // SAFETY: mutation check: dropped trigger catalogue_pack_competency_frozen_check in 0011 -> this test failed (row updated)
    // SAFETY: mutation check: function body without the EXISTS check (always RETURN) -> this test and the TRUNCATE test failed
    for (const role of ['aivera_app', 'aivera_migrator'] as const)
      it(`${role} cannot update or delete a row of version 1 in any catalogue table`, async () => {
        const db = role === 'aivera_app' ? app : migrator;
        for (const t of TABLES) {
          const table = sql`${sql.identifier('jobs')}.${sql.identifier(t)}`;
          const column = sql.identifier(t === 'catalogue_version' ? 'reason' : 'retired');
          const refused = { code: '23514', constraint: 'catalogue_version_frozen_check' };
          expect(
            await pgError(db.execute(sql`update ${table} set ${column} = ${column} where version = 1`)),
            t,
          ).toEqual(refused);
          expect(await pgError(db.execute(sql`delete from ${table} where version = 1`)), t).toEqual(refused);
        }
      });

    // SAFETY: mutation check: catalogue_pack_frozen_check set to ENABLE, not ENABLE ALWAYS, in 0011 -> this test failed (O, not A)
    it('every freeze trigger is ENABLE ALWAYS, so session_replication_role = replica does not switch it off', async () => {
      const triggers = await admin.execute<{ name: string; enabled: string }>(sql`select tgname as name,
          tgenabled as enabled from pg_trigger where tgrelid::regclass::text like 'jobs.catalogue\_%' and not tgisinternal
          order by tgname`);
      expect([...triggers]).toHaveLength(12);
      expect([...triggers].filter((t) => t.enabled !== 'A')).toEqual([]);
    });

    it('the owner cannot empty a catalogue table with TRUNCATE, which skips row triggers', async () => {
      for (const t of TABLES)
        expect(
          await pgError(migrator.execute(sql`truncate ${sql.identifier('jobs')}.${sql.identifier(t)} cascade`)),
          t,
        ).toEqual({ code: '23514', constraint: 'catalogue_version_frozen_check' });
      expect((await counts())['catalogue_pack_competency']).toBeGreaterThan(0);
    });
  });

  it('Scenario: Only one draft at a time; a draft, unlike a published version, can be discarded', async () => {
    const draft = (version: number) =>
      app.execute(sql`insert into jobs.catalogue_version (version, status, created_by, created_at)
        values (${version}, 'draft', '0190d4a2-0000-7000-8000-00000000a1e1', now())`);
    await draft(2);
    expect(await pgError(draft(3))).toEqual({ code: '23505', constraint: 'catalogue_version_one_draft_idx' });
    await app.execute(sql`delete from jobs.catalogue_version where version = 2`);
    expect((await counts())['catalogue_version']).toBe(1);
  });

  // SAFETY: mutation check: hasEnglish without its coalesce in 0010 -> this test failed ({} and {"ar"} accepted)
  it('a label needs English text: no en, a non-string en or a blank en is refused', async () => {
    await app.execute(sql`insert into jobs.catalogue_version (version, status, created_by, created_at)
      values (2, 'draft', 'system:seed', now())`);
    try {
      for (const label of ['{}', '{"ar":"x"}', '{"en":5}', '{"en":" "}', '"UAE"'])
        expect(
          await pgError(
            app.execute(sql`insert into jobs.catalogue_region (version, key, position, label)
              values (2, 'gcc', 0, ${label}::jsonb)`),
          ),
          label,
        ).toEqual({ code: '23514', constraint: 'catalogue_region_label_check' });
    } finally {
      // A label wrongly accepted would block the draft's delete, so it goes first.
      await app.execute(sql`delete from jobs.catalogue_region where version = 2`);
      await app.execute(sql`delete from jobs.catalogue_version where version = 2`);
    }
  });

  it('a version actor is an opaque user id or system:seed, never a name or an email', async () => {
    expect(
      await pgError(
        app.execute(sql`insert into jobs.catalogue_version (version, status, created_by, created_at)
          values (2, 'draft', 'priya@example.com', now())`),
      ),
    ).toEqual({ code: '23514', constraint: 'catalogue_version_actor_check' });
  });
});

/** Thrown to roll back a probe transaction, so no probe row is left behind. */
class Rollback extends Error {}

const WS = '0190d4a2-0000-7000-8000-000000004301';
const USER = '0190d4a2-0000-7000-8000-00000000a1e1';
/** Writes one row as the superuser (no RLS, so no workspace is needed) and rolls it back; the write's outcome. */
const write = (rows: (key: string) => ReturnType<typeof sql>[], key: string) =>
  admin
    .transaction(async (tx) => {
      for (const row of rows(key)) await tx.execute(row);
      // Deferred constraint triggers (competency weights) run here, before the rollback.
      await tx.execute(sql`set constraints all immediate`);
      throw new Rollback();
    })
    .then(
      () => 'accepted',
      (error: unknown) => {
        if (error instanceof Rollback) return 'accepted';
        // Only a check constraint counts as refused: any other failure is a broken probe, not a passing example.
        const pg = ((error as { cause?: unknown }).cause ?? error) as { code?: string };
        if (pg.code === '23514') return 'refused';
        throw error;
      },
    );

const job = (jobType: string) =>
  sql`insert into jobs.job (id, workspace_id, title, job_type, description, stage, published, synthetic, created_by,
      created_at) values ('0190d4a2-0000-7000-8000-000000004302', ${WS}, 'Backend Engineer', ${jobType}, 'Synthetic.',
      'defining_rubric', false, true, ${USER}, now())`;
const competency = (packKey: string) => [
  job('software_engineering'),
  sql`insert into jobs.rubric_version (id, workspace_id, job_id, version, status, success_statement, created_by,
      created_at) values ('0190d4a2-0000-7000-8000-000000004303', ${WS}, '0190d4a2-0000-7000-8000-000000004302', 1,
      'draft', 'Ships reliable work.', ${USER}, now())`,
  sql`insert into jobs.competency (id, workspace_id, rubric_version_id, name, evidence_expected, weight_percent,
      level_needed, type, origin, pack_key, pack_version, position) values (gen_random_uuid(), ${WS},
      '0190d4a2-0000-7000-8000-000000004303', 'Ledger', 'Code', 100, 3, 'desirable', 'domain_pack', ${packKey}, 1, 0)`,
];
const account = (workType: string) => [
  sql`insert into candidate_accounts.account (identity_user_id, work_type, created_at, updated_at)
      values (${USER}, ${workType}, now(), now())`,
];

describe('Scenario Outline: Keys are validated by format, not by a hard-coded list', () => {
  // SAFETY: mutation check: competency_pack_format_check without the regex (only the reserved list) in 0010 -> this test failed (Payments-Fintech accepted)
  const examples = [
    ['payments_fintech', 'accepted'],
    ['insurance', 'accepted'],
    ['Payments-Fintech', 'refused'],
    ['x', 'refused'],
    ['none', 'refused'],
  ] as const;
  for (const [key, result] of examples)
    it(`a key "${key}" is ${result} as a competency pack_key, a job's job_type and a candidate's work_type`, async () => {
      expect({
        competency: await write(competency, key),
        job: await write((k) => [job(k)], key),
        workType: await write(account, key),
      }).toEqual({ competency: result, job: result, workType: result });
    });
});

/** "created", or the JobError message a create was refused with. */
const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => 'created',
    (error: unknown) => (error instanceof JobError ? `refused: ${error.message}` : Promise.reject(error)),
  );

// AIV-P2-044 Gherkin, through the jobs contract as the app calls it. Last in the file: the final scenario publishes
// version 2, which can never be removed.
describe('Feature: Read the published catalogue from the database', () => {
  const NOW = new Date('2026-11-20T09:00:00.000Z');
  const RIYA = '0190d4a2-0000-7000-8000-00000000a1e2';
  let jobs: JobsContract;
  let workspaces: WorkspacesContract;
  let ws: string;
  const as = <T>(fn: (ctx: WorkspaceContext) => Promise<T>) => workspaces.withWorkspace({ userId: RIYA }, ws, fn);
  const ledger: Competency = {
    name: 'Ledger and double-entry accounting',
    evidenceExpected: 'Ledger code with balancing tests',
    weightPercent: 100,
    levelNeeded: 3,
    type: 'desirable',
    origin: 'domain_pack',
    packKey: 'payments_fintech',
    packVersion: 1,
  };
  const create = (jobType: string, competencies: Competency[] = [ledger]) =>
    as((ctx) =>
      jobs.createJobWithDraftRubric(ctx, {
        title: 'Backend Engineer, Payments',
        jobType,
        description: 'Synthetic.',
        synthetic: true,
        competencies,
      }),
    );
  beforeAll(async () => {
    const audit = createAudit(app, () => NOW);
    workspaces = createWorkspaces(app, audit);
    jobs = createJobs(workspaces, audit, () => NOW);
    ws = (
      await workspaces.createWorkspace({
        name: 'Demo',
        company: 'Demo',
        hiringFocus: 'software_engineering',
        synthetic: true,
        creatorUserId: RIYA,
      })
    ).id;
  });

  it('Scenario: Only the published version is read outside /ops', async () => {
    await admin.execute(sql`insert into jobs.catalogue_version (version, status, created_by, created_at)
      values (2, 'draft', ${RIYA}, now())`);
    await admin.execute(sql`insert into jobs.catalogue_pack (version, key, position, label)
      values (2, 'insurance', 8, '{"en":"Insurance"}'::jsonb)`);
    try {
      const published = await createCatalogueReads(app).getPublishedCatalogue();
      expect(published.version).toBe(1);
      expect(published.packs.map((p) => p.key)).not.toContain('insurance');
      expect(await refusal(create('software_engineering', [{ ...ledger, packKey: 'insurance' }]))).toBe(
        'refused: A competency from a domain pack names its pack and version, and no other competency does.',
      );
    } finally {
      await admin.execute(sql`delete from jobs.catalogue_pack where version = 2`);
      await admin.execute(sql`delete from jobs.catalogue_version where version = 2`);
    }
  });

  // SAFETY: mutation check: removed the offeredJobTypes check in insertNewJob -> this test failed (astrology created)
  it('Scenario Outline: Server validation follows the catalogue', async () => {
    expect(await refusal(create('software_engineering'))).toBe('created');
    expect(await refusal(create('astrology'))).toBe('refused: Unknown job type.');
    expect(
      await refusal(
        as((ctx) => jobs.createJob(ctx, { title: 'x', jobType: 'astrology', description: '', synthetic: true })),
      ),
    ).toBe('refused: Unknown job type.');
  });

  it('Scenario: A kept pack competency records the version that seeded it', async () => {
    const { job: created } = await create('software_engineering');
    const [rubric] = (await as((ctx) => jobs.listRubricVersions(ctx, created.id))) ?? [];
    expect(rubric?.competencies).toEqual([
      expect.objectContaining({
        name: 'Ledger and double-entry accounting',
        packKey: 'payments_fintech',
        packVersion: 1,
      }),
    ]);
  });

  it('a retired job type or pack stays where it is but starts no new job or competency', async () => {
    const { job: created } = await create('software_engineering');
    // Version 2 retires Software engineering and Payments and fintech; published by hand, as the editor (AIV-P2-047) will.
    await admin.transaction(async (tx) => {
      await tx.execute(sql`insert into jobs.catalogue_version (version, status, created_by, created_at)
        values (2, 'draft', ${RIYA}, now())`);
      await tx.execute(sql`insert into jobs.catalogue_job_type (version, key, position, label, evidence,
          starter_competencies, retired)
        select 2, key, position, label, evidence, starter_competencies, key = 'software_engineering'
        from jobs.catalogue_job_type where version = 1`);
      await tx.execute(sql`insert into jobs.catalogue_pack (version, key, position, label, retired)
        select 2, key, position, label, key = 'payments_fintech' from jobs.catalogue_pack where version = 1`);
      await tx.execute(sql`update jobs.catalogue_version set status = 'published', published_by = ${RIYA},
        published_at = now(), reason = 'Retire two entries for the test' where version = 2`);
    });
    expect((await createCatalogueReads(app).getPublishedCatalogue()).version).toBe(2);
    const own: Competency = { ...ledger, origin: 'added_by_recruiter', packKey: null, packVersion: null };
    expect(await refusal(create('software_engineering', [own]))).toBe('refused: Unknown job type.');
    // SAFETY: mutation check: accepted a retired pack without a kept competency in assertValidCompetencies -> this test failed
    expect(await refusal(create('qa_test_automation'))).toBe(
      'refused: A competency from a domain pack names its pack and version, and no other competency does.',
    );
    const saved = as((ctx) =>
      jobs.saveRubric(ctx, created.id, { successStatement: 'Ships reliable work.', competencies: [ledger] }),
    );
    await expect(saved).resolves.toMatchObject({ jobId: created.id });
    expect((await as((ctx) => jobs.getJob(ctx, created.id)))?.jobType).toBe('software_engineering');
  });
});

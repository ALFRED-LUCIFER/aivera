import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, type Db } from '@aivera/db';
import { JOB_TYPE_CATALOGUE, listDomainPacks, REGIONS } from '@aivera/jobs';
import { createCatalogueReads } from '@aivera/jobs/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P2-043: the catalogue tables and published version 1 (ADR-013), on real PostgreSQL.

const repo = join(import.meta.dirname, '..', '..', '..');
const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@aivera/db/sql/roles.sql'), 'utf8');
const dbCli = join(repo, 'packages', 'db', 'src', 'cli.ts');
const seedSql = readFileSync(
  join(repo, 'modules', 'jobs', 'src', 'infrastructure', 'migrations', '0017_catalogue_v1_seed.sql'),
  'utf8',
);
const en: unknown = JSON.parse(readFileSync(join(repo, 'packages', 'i18n', 'messages', 'en.json'), 'utf8'));
const text = (key: string) => ({
  en: key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], en),
});

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
  it('Scenario: Version 1 equals the code catalogue', async () => {
    const catalogue = await createCatalogueReads(app).getPublishedCatalogue();
    expect(catalogue).toEqual({
      version: 1,
      status: 'published',
      publishedAt: expect.any(Date),
      publishedBy: 'system:seed',
      reason: 'Catalogue version 1 from code (AIV-P1-004, AIV-P1-061)',
      jobTypes: JOB_TYPE_CATALOGUE.map((t) => ({
        key: t.key,
        label: text(t.labelKey),
        evidence: text(t.evidenceKey),
        starterCompetencies: t.starterCompetencies,
        retired: false,
      })),
      regions: [
        { key: 'uae', label: { en: 'UAE' }, retired: false },
        { key: 'ksa', label: { en: 'KSA' }, retired: false },
        { key: 'india', label: { en: 'India' }, retired: false },
      ],
      packs: listDomainPacks().map((p) => ({
        key: p.key,
        label: text(p.labelKey),
        retired: false,
        competencies: p.competencies.map((c) => ({ ...c, retired: false })),
        hints: REGIONS.flatMap((region) => p.hints[region].map((h) => ({ ...h, region, retired: false }))),
      })),
    });
    // The snapshot really reaches every entry, so an empty catalogue on both sides cannot pass.
    expect(catalogue?.jobTypes).toHaveLength(10);
    expect(catalogue?.packs).toHaveLength(8);
    expect(catalogue?.packs.every((p) => p.competencies.length > 0 && p.hints.length > 0)).toBe(true);
    expect(await createCatalogueReads(app).getCatalogueVersion(1)).toEqual(catalogue);
    expect(await createCatalogueReads(app).getCatalogueVersion(2)).toBeNull();
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

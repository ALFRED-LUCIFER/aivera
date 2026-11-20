import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AssessmentContract, RubricInput } from '@credalent/assessment';
import { createAssessment } from '@credalent/assessment/composition';
import type { AuditContract } from '@credalent/audit';
import { createAudit } from '@credalent/audit/composition';
import { createDb, withWorkspace, type Db } from '@credalent/db';
import type { EvidenceContract, RecordEvidenceInput } from '@credalent/evidence';
import { createEvidence } from '@credalent/evidence/composition';
import { ForbiddenError, type WorkspaceContext, type WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P1-030 against real PostgreSQL, connected as the non-owner aivera_app role (ADR-004, ADR-005). Synthetic cast only.

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1';
const LINA = '0190d4a2-0000-7000-8000-0000000011aa';
const SARA = '0190d4a2-0000-7000-8000-00000000c001';
const NOW = new Date('2026-11-20T09:00:00.000Z');
// Opaque ids of the jobs module: the Senior AI Engineer job, its rubric version 2 and two of its competencies.
const JOB = '0190d4a2-0000-7000-8000-000000000b01';
const RUBRIC: RubricInput = {
  versionId: '0190d4a2-0000-7000-8000-000000000b02',
  competencies: [
    { id: '0190d4a2-0000-7000-8000-0000000c0e01', weightPercent: 60, levelNeeded: 4, type: 'mandatory' },
    { id: '0190d4a2-0000-7000-8000-0000000c0e02', weightPercent: 40, levelNeeded: 2, type: 'desirable' },
  ],
};
const [RETRIEVAL, ARABIC] = RUBRIC.competencies.map((c) => c.id) as [string, string];

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let workspaces: WorkspacesContract;
let audit: AuditContract;
let evidence: EvidenceContract;
let assessment: AssessmentContract;
let w1: string;
let w2: string;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const as = <T>(userId: string, workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId }, workspaceId, fn);

const newWorkspace = async (name: string) =>
  (await workspaces.createWorkspace({ name, company: name, hiringFocus: 'AI', synthetic: true, creatorUserId: ALEX }))
    .id;

const harness = (competencyId: string, level: number): RecordEvidenceInput => ({
  candidateId: SARA,
  source: {
    kind: 'repository',
    label: 'llm-eval-harness',
    url: 'https://code.credalent.example/sara/llm-eval-harness',
    blobFileId: null,
    capturedAt: new Date('2026-11-10T08:00:00.000Z'),
    checkedAt: new Date('2026-11-12T08:00:00.000Z'),
    checkMethod: 'Commit history',
  },
  items: [
    {
      excerpt: 'authored 412 of 460 commits',
      excerptSpan: null,
      provenance: 'corroborated',
      strength: 'strong',
      limit: 'Shows the tooling, not how results changed product decisions.',
      competencies: [{ jobId: JOB, competencyId, level }],
    },
  ],
  synthetic: true,
});

const claim = (competencyId: string, level: number): RecordEvidenceInput => ({
  candidateId: SARA,
  source: {
    kind: 'cv',
    label: 'CV',
    url: null,
    blobFileId: null,
    capturedAt: new Date('2026-11-10T08:00:00.000Z'),
    checkedAt: null,
    checkMethod: null,
  },
  items: [
    {
      excerpt: 'built a Gulf Arabic evaluation set',
      excerptSpan: 'page 2',
      provenance: 'claim',
      strength: 'supporting',
      limit: 'A claim until a document or a second source supports it.',
      competencies: [{ jobId: JOB, competencyId, level }],
    },
  ],
  synthetic: true,
});

const assessSara = (workspaceId: string) =>
  as(ALEX, workspaceId, async (ctx) =>
    assessment.assessCandidate(ctx, {
      candidateId: SARA,
      jobId: JOB,
      rubric: RUBRIC,
      evidence: await evidence.listEvidenceForCandidate(ctx, SARA, JOB),
    }),
  );

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 1 });
  audit = createAudit(app);
  workspaces = createWorkspaces(app, audit);
  evidence = createEvidence(workspaces, () => NOW);
  assessment = createAssessment(workspaces, audit, () => NOW);
  w1 = await newWorkspace('Demo hiring team');
  w2 = await newWorkspace('Gulf Talent Partners');
  await withWorkspace(app, w1, (tx) =>
    tx.execute(
      sql`insert into workspaces.member (workspace_id, user_id, role, status) values (${w1}, ${LINA}, 'interviewer', 'active')`,
    ),
  );
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

describe('Migrations', () => {
  it('assessment.result is owned by aivera_migrator with row-level security enabled and forced', async () => {
    const tables = await admin.execute<{ name: string; owner: string; rls: boolean; forced: boolean }>(sql`
      select t.tablename as name, t.tableowner as owner, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_tables t join pg_class c on c.oid = format('%I.%I', t.schemaname, t.tablename)::regclass
      where t.schemaname = 'assessment' order by name`);
    expect([...tables]).toEqual([{ name: 'result', owner: 'aivera_migrator', rls: true, forced: true }]);
  });

  it('an evidence link level outside 0–5 is refused by the domain and the database', async () => {
    await expect(as(ALEX, w1, (ctx) => evidence.recordEvidence(ctx, harness(RETRIEVAL, 6)))).rejects.toThrow(
      'A level is a whole number from 0 to 5',
    );
    await as(ALEX, w1, (ctx) => evidence.recordEvidence(ctx, harness(RETRIEVAL, 0)));
    await expect(
      withWorkspace(app, w1, (tx) =>
        tx.execute(sql`update evidence.competency_link set level = 9 where workspace_id = ${w1}`),
      ),
    ).rejects.toThrow();
  });
});

describe('Scenario: Claims count zero in the backed score, stored and audited', () => {
  it('a claim alone scores 0 backed; real work raises it; a re-run with nothing new stores nothing', async () => {
    await as(ALEX, w1, (ctx) => evidence.recordEvidence(ctx, claim(ARABIC, 4)));
    const first = await assessSara(w1);
    expect([first.backedScore, first.upperBound]).toEqual([0, 32]);

    await as(ALEX, w1, (ctx) => evidence.recordEvidence(ctx, harness(RETRIEVAL, 5)));
    const second = await assessSara(w1);
    expect([second.backedScore, second.upperBound, second.meetsNeed, second.confidence]).toEqual([60, 92, 1, 'High']);
    expect(second.competencies[0]?.proven.itemIds).toHaveLength(1);

    const again = await assessSara(w1);
    expect(again.id).toBe(second.id);
    expect(await as(ALEX, w1, (ctx) => assessment.getLatestAssessment(ctx, SARA, JOB))).toEqual(second);

    const entries = await audit.listFor(w1, { type: 'candidate', id: SARA });
    expect(entries.map((e) => [e.action, e.before, e.after])).toEqual([
      ['score.changed', null, { backedScore: 0, upperBound: 32, rubricVersionId: RUBRIC.versionId }],
      [
        'score.changed',
        { backedScore: 0, upperBound: 32, rubricVersionId: RUBRIC.versionId },
        { backedScore: 60, upperBound: 92, rubricVersionId: RUBRIC.versionId },
      ],
    ]);
  });
});

describe('Scenario: Assessments never cross workspaces', () => {
  // SAFETY: mutation check: ALTER POLICY result_tenant_isolation USING (true) WITH CHECK (true) -> this test failed (W2 saw W1's row)
  it("W2 sees none of W1's results, even with no WHERE clause", async () => {
    expect(await as(ALEX, w2, (ctx) => assessment.getLatestAssessment(ctx, SARA, JOB))).toBeNull();
    expect([...(await withWorkspace(app, w2, (tx) => tx.execute(sql`select * from assessment.result`)))]).toEqual([]);
    const [own] = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from assessment.result`),
    );
    expect(own?.n).toBeGreaterThan(0);
  });

  it('a stored result cannot be rewritten', async () => {
    await expect(
      withWorkspace(app, w1, (tx) => tx.execute(sql`update assessment.result set backed_score = 100`)),
    ).rejects.toThrow();
  });
});

describe('Who may assess', () => {
  it('an interviewer can neither assess nor read assessments', async () => {
    await expect(
      as(LINA, w1, (ctx) =>
        assessment.assessCandidate(ctx, { candidateId: SARA, jobId: JOB, rubric: RUBRIC, evidence: [] }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(as(LINA, w1, (ctx) => assessment.getLatestAssessment(ctx, SARA, JOB))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

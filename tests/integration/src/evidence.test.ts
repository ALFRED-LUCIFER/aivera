import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createAudit } from '@credalent/audit/composition';
import type { CandidatesContract } from '@credalent/candidates';
import { createCandidates } from '@credalent/candidates/composition';
import { createDb, withWorkspace, type Db } from '@credalent/db';
import { EvidenceRecordedV1, PROVENANCES, type EvidenceContract, type RecordEvidenceInput } from '@credalent/evidence';
import { createEvidence } from '@credalent/evidence/composition';
import { ForbiddenError, type WorkspaceContext, type WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P1-024 acceptance scenarios against real PostgreSQL, connected as the non-owner aivera_app role (ADR-004, ADR-005).
// Synthetic cast only (docs/00-product/personas.md).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1';
const LINA = '0190d4a2-0000-7000-8000-0000000011aa';
const NOW = new Date('2026-11-18T09:00:00.000Z');
// The Senior AI Engineer job and its "Retrieval and evaluation" competency: opaque ids of the jobs module.
const JOB = '0190d4a2-0000-7000-8000-000000000b01';
const RETRIEVAL = '0190d4a2-0000-7000-8000-0000000c0e01';

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let workspaces: WorkspacesContract;
let candidates: CandidatesContract;
let evidence: EvidenceContract;
let w1: string;
let w2: string;
let sara: string;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const as = <T>(userId: string, workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId }, workspaceId, fn);

const newWorkspace = async (name: string) =>
  (await workspaces.createWorkspace({ name, company: name, hiringFocus: 'AI', synthetic: true, creatorUserId: ALEX }))
    .id;

const person = (workspaceId: string, displayName: string) =>
  as(ALEX, workspaceId, async (ctx) => {
    const email = `${displayName.toLowerCase().replaceAll(' ', '.')}@example.com`;
    const created = await candidates.findOrCreatePerson(ctx, {
      displayName,
      identifiers: [{ type: 'email', value: email }],
      synthetic: true,
    });
    return created.personId;
  });

const repository = (
  candidateId: string,
  item: Partial<RecordEvidenceInput['items'][number]> = {},
): RecordEvidenceInput => ({
  candidateId,
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
      competencies: [{ jobId: JOB, competencyId: RETRIEVAL }],
      ...item,
    },
  ],
  synthetic: true,
});

const count = async (workspaceId: string, table: 'source' | 'item' | 'outbox') =>
  Number(
    (
      await withWorkspace(app, workspaceId, (tx) =>
        tx.execute<{ n: string }>(
          sql`select count(*) as n from ${sql.identifier('evidence')}.${sql.identifier(table)}`,
        ),
      )
    )[0]?.n,
  );

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 1 });
  workspaces = createWorkspaces(app, createAudit(app));
  candidates = createCandidates(workspaces, () => NOW);
  evidence = createEvidence(workspaces, () => NOW);
  w1 = await newWorkspace('Demo hiring team');
  w2 = await newWorkspace('Gulf Talent Partners');
  sara = await person(w1, 'Sara Al Qahtani');
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
  it('evidence tables are owned by aivera_migrator with row-level security enabled and forced', async () => {
    const tables = await admin.execute<{ name: string; owner: string; rls: boolean; forced: boolean }>(sql`
      select t.tablename as name, t.tableowner as owner, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_tables t join pg_class c on c.oid = format('%I.%I', t.schemaname, t.tablename)::regclass
      where t.schemaname = 'evidence' order by name`);
    expect([...tables]).toEqual(
      ['competency_link', 'item', 'outbox', 'source'].map((name) => ({
        name,
        owner: 'aivera_migrator',
        rls: true,
        forced: true,
      })),
    );
  });
});

describe('Scenario: Recording a repository as evidence', () => {
  // SAFETY: mutation check: removed publishRecorded from recordEvidence -> this test failed (no outbox row)
  it('stores the item corroborated and strong, the source checked by commit history, and the event in the outbox', async () => {
    const { sourceId, itemIds } = await as(ALEX, w1, (ctx) => evidence.recordEvidence(ctx, repository(sara)));
    const [listed] = await as(ALEX, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, sara, JOB));
    expect(listed).toMatchObject({
      id: itemIds[0],
      excerpt: 'authored 412 of 460 commits',
      provenance: 'corroborated',
      strength: 'strong',
      synthetic: true,
      createdAt: NOW,
      competencies: [{ jobId: JOB, competencyId: RETRIEVAL }],
      source: {
        id: sourceId,
        kind: 'repository',
        checkMethod: 'Commit history',
        checkedAt: new Date('2026-11-12T08:00:00.000Z'),
      },
    });
    const events = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ type: string; payload: unknown }>(
        sql`select type, payload from evidence.outbox where dedupe_key = ${`source:${sourceId}`}`,
      ),
    );
    expect([...events]).toEqual([{ type: EvidenceRecordedV1.type, payload: { candidateId: sara, sourceId, itemIds } }]);
  });

  it('the event is written in the same transaction: a rolled-back record leaves neither evidence nor event', async () => {
    const before = await Promise.all([count(w1, 'source'), count(w1, 'outbox')]);
    await expect(
      as(ALEX, w1, async (ctx) => {
        await evidence.recordEvidence(ctx, repository(sara));
        throw new Error('the caller fails after recording');
      }),
    ).rejects.toThrow('the caller fails after recording');
    expect(await Promise.all([count(w1, 'source'), count(w1, 'outbox')])).toEqual(before);
  });

  it('linkToCompetency adds a link once, however often it is called', async () => {
    const { itemIds } = await as(ALEX, w1, (ctx) =>
      evidence.recordEvidence(ctx, repository(sara, { competencies: [] })),
    );
    const itemId = itemIds[0] ?? '';
    for (let i = 0; i < 2; i++)
      await as(ALEX, w1, (ctx) => evidence.linkToCompetency(ctx, itemId, { jobId: JOB, competencyId: RETRIEVAL }));
    expect((await as(ALEX, w1, (ctx) => evidence.getEvidenceItem(ctx, itemId)))?.competencies).toEqual([
      { jobId: JOB, competencyId: RETRIEVAL },
    ]);
  });
});

describe('Scenario: A claim cannot be stronger than Supporting', () => {
  it('a "CV, page 2" claim set to Medium is rejected and nothing is written', async () => {
    const before = await Promise.all([count(w1, 'source'), count(w1, 'item'), count(w1, 'outbox')]);
    const claim: RecordEvidenceInput = {
      ...repository(sara, {
        excerpt: 'cut cost per request by 40%',
        excerptSpan: 'page 2',
        provenance: 'claim',
        strength: 'medium',
      }),
      source: {
        kind: 'cv',
        label: 'CV',
        url: null,
        blobFileId: null,
        capturedAt: NOW,
        checkedAt: null,
        checkMethod: null,
      },
    };
    await expect(as(ALEX, w1, (ctx) => evidence.recordEvidence(ctx, claim))).rejects.toThrow(
      'A claim cannot be stronger than Supporting',
    );
    expect(await Promise.all([count(w1, 'source'), count(w1, 'item'), count(w1, 'outbox')])).toEqual(before);
  });

  // SAFETY: mutation check: dropped item_claim_strength_check (ALTER TABLE … DROP CONSTRAINT) -> this test failed (insert succeeded)
  it('the database refuses it too, whatever the write path', async () => {
    const { sourceId } = await as(ALEX, w1, (ctx) => evidence.recordEvidence(ctx, repository(sara)));
    await expect(
      withWorkspace(app, w1, (tx) =>
        tx.execute(sql`insert into evidence.item
          (id, workspace_id, source_id, candidate_id, excerpt, provenance, strength, limit_statement, synthetic, created_at)
          values (${crypto.randomUUID()}, ${w1}, ${sourceId}, ${sara}, 'x', 'awaiting-defence', 'medium', 'x', true, now())`),
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'item_claim_strength_check' });
  });
});

describe('Scenario Outline: Provenance and strength values are closed lists', () => {
  it.each(PROVENANCES)('an item recorded with provenance %s is accepted', async (provenance) => {
    const { itemIds } = await as(ALEX, w1, (ctx) =>
      evidence.recordEvidence(ctx, repository(sara, { provenance, strength: 'supporting' })),
    );
    expect((await as(ALEX, w1, (ctx) => evidence.getEvidenceItem(ctx, itemIds[0] ?? '')))?.provenance).toBe(provenance);
  });

  it('a value off the list is refused by the domain and the database', async () => {
    await expect(
      as(ALEX, w1, (ctx) => evidence.recordEvidence(ctx, repository(sara, { provenance: 'verified' as never }))),
    ).rejects.toThrow('The provenance is not one of the listed values');
    const { sourceId } = await as(ALEX, w1, (ctx) => evidence.recordEvidence(ctx, repository(sara)));
    await expect(
      withWorkspace(app, w1, (tx) =>
        tx.execute(sql`insert into evidence.item
          (id, workspace_id, source_id, candidate_id, excerpt, provenance, strength, limit_statement, synthetic, created_at)
          values (${crypto.randomUUID()}, ${w1}, ${sourceId}, ${sara}, 'x', 'submitted', 'weak', 'x', true, now())`),
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'item_strength_check' });
  });
});

describe('Scenario: Every item states its limit', () => {
  it('an item recorded without a limit statement is rejected with "State what this evidence does not show"', async () => {
    const before = await count(w1, 'item');
    await expect(as(ALEX, w1, (ctx) => evidence.recordEvidence(ctx, repository(sara, { limit: ' ' })))).rejects.toThrow(
      'State what this evidence does not show',
    );
    expect(await count(w1, 'item')).toBe(before);
  });
});

describe('Scenario: Evidence never crosses workspaces', () => {
  // SAFETY: mutation check: ALTER POLICY item_tenant_isolation and source_tenant_isolation USING (true) WITH CHECK (true) -> this test failed (W2 saw W1's rows); dropping the policy instead hides every row under FORCE, so the test would still pass
  it("a W2 user listing Sara's candidate id gets no rows, even with no WHERE clause", async () => {
    await as(ALEX, w1, (ctx) => evidence.recordEvidence(ctx, repository(sara)));
    expect(await as(ALEX, w2, (ctx) => evidence.listEvidenceForCandidate(ctx, sara, JOB))).toEqual([]);
    for (const table of ['source', 'item', 'competency_link', 'outbox'])
      expect([
        ...(await withWorkspace(app, w2, (tx) =>
          tx.execute(sql`select * from ${sql.identifier('evidence')}.${sql.identifier(table)}`),
        )),
      ]).toEqual([]);
    expect(await count(w1, 'item')).toBeGreaterThan(0);
  });

  it("an item cannot cite another workspace's source", async () => {
    const { sourceId } = await as(ALEX, w1, (ctx) => evidence.recordEvidence(ctx, repository(sara)));
    await expect(
      withWorkspace(app, w2, (tx) =>
        tx.execute(sql`insert into evidence.item
          (id, workspace_id, source_id, candidate_id, excerpt, provenance, strength, limit_statement, synthetic, created_at)
          values (${crypto.randomUUID()}, ${w2}, ${sourceId}, ${sara}, 'x', 'submitted', 'medium', 'x', true, now())`),
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
});

describe('Scenario: Listing evidence for a candidate with none', () => {
  it('Paolo Garcia, with no evidence, gets an empty list on Senior AI Engineer, not an error', async () => {
    const paolo = await person(w1, 'Paolo Garcia');
    expect(await as(ALEX, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, paolo, JOB))).toEqual([]);
  });
});

describe('Authorisation (ADR-005 point 6)', () => {
  // SAFETY: mutation check: removed authorize(ctx, 'candidate.view') from listEvidenceForCandidate -> this test failed (no ForbiddenError)
  it('an interviewer can neither record nor list evidence until applications give a job to check (AIV-P1-017)', async () => {
    await expect(as(LINA, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, sara, JOB))).rejects.toThrow(
      ForbiddenError,
    );
    await expect(as(LINA, w1, (ctx) => evidence.recordEvidence(ctx, repository(sara)))).rejects.toThrow(ForbiddenError);
  });
});

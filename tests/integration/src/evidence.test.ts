import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AuditContract } from '@credalent/audit';
import { createAudit } from '@credalent/audit/composition';
import type { CandidatesContract } from '@credalent/candidates';
import { createCandidates } from '@credalent/candidates/composition';
import { createDb, withWorkspace, type Db } from '@credalent/db';
import {
  EvidenceRecordedV1,
  NEAR_DUPLICATE_THRESHOLD,
  PROVENANCES,
  type EvidenceContract,
  type RecordEvidenceInput,
} from '@credalent/evidence';
import { createEvidence } from '@credalent/evidence/composition';
import { ForbiddenError, type WorkspaceContext, type WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
let audit: AuditContract;
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
      competencies: [{ jobId: JOB, competencyId: RETRIEVAL, level: 4 }],
      ...item,
    },
  ],
  synthetic: true,
});

const count = async (workspaceId: string, table: 'source' | 'item' | 'competency_link' | 'outbox') =>
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
  audit = createAudit(app);
  workspaces = createWorkspaces(app, audit);
  candidates = createCandidates(workspaces, () => NOW);
  evidence = createEvidence(workspaces, audit, () => NOW);
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
      [
        'competency_link',
        'duplicate_flag',
        'inbox',
        'item',
        'merged_pull_request',
        'outbox',
        'portal_token',
        'repository_read',
        'repository_skill_grade',
        'repository_skill_signal',
        'request',
        'request_item',
        'source',
      ].map((name) => ({
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
      competencies: [{ jobId: JOB, competencyId: RETRIEVAL, level: 4 }],
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
      await as(ALEX, w1, (ctx) =>
        evidence.linkToCompetency(ctx, itemId, { jobId: JOB, competencyId: RETRIEVAL, level: 4 }),
      );
    expect((await as(ALEX, w1, (ctx) => evidence.getEvidenceItem(ctx, itemId)))?.competencies).toEqual([
      { jobId: JOB, competencyId: RETRIEVAL, level: 4 },
    ]);
    await expect(
      as(ALEX, w2, (ctx) => evidence.linkToCompetency(ctx, itemId, { jobId: JOB, competencyId: RETRIEVAL, level: 4 })),
    ).rejects.toThrow('No such evidence item');
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
  // SAFETY: mutation check: ALTER POLICY <t>_tenant_isolation USING (true) WITH CHECK (true) on item, source, competency_link and outbox -> this test failed (W2 saw W1's rows); dropping the policy instead hides every row under FORCE, so the test would still pass
  it("a W2 user listing Sara's candidate id gets no rows, even with no WHERE clause", async () => {
    await as(ALEX, w1, (ctx) => evidence.recordEvidence(ctx, repository(sara)));
    expect(await as(ALEX, w2, (ctx) => evidence.listEvidenceForCandidate(ctx, sara, JOB))).toEqual([]);
    for (const table of ['source', 'item', 'competency_link', 'duplicate_flag', 'outbox'])
      expect([
        ...(await withWorkspace(app, w2, (tx) =>
          tx.execute(sql`select * from ${sql.identifier('evidence')}.${sql.identifier(table)}`),
        )),
      ]).toEqual([]);
    for (const table of ['source', 'item', 'competency_link', 'outbox'] as const)
      expect(await count(w1, table)).toBeGreaterThan(0);
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
    const { itemIds } = await as(ALEX, w1, (ctx) => evidence.recordEvidence(ctx, repository(sara)));
    const itemId = itemIds[0] ?? '';
    await expect(as(LINA, w1, (ctx) => evidence.getEvidenceItem(ctx, itemId))).rejects.toThrow(ForbiddenError);
    await expect(
      as(LINA, w1, (ctx) => evidence.linkToCompetency(ctx, itemId, { jobId: JOB, competencyId: RETRIEVAL, level: 4 })),
    ).rejects.toThrow(ForbiddenError);
    await expect(as(LINA, w1, (ctx) => evidence.purgeSyntheticEvidence(ctx))).rejects.toThrow(ForbiddenError);
  });
});

// AIV-P1-071: text fingerprints and the "Also submitted by another applicant" flag. Synthetic write-ups only.
const METRICS = [
  'recall',
  'precision',
  'latency',
  'cost',
  'drift',
  'coverage',
  'labels',
  'queries',
  'passages',
  'reranking',
];
/** A synthetic write-up of about 900 words. */
const harnessWriteUp = (title = 'Retrieval evaluation harness') =>
  `${title}\n${Array.from(
    { length: 64 },
    (_, i) =>
      `In week ${i + 1} the harness measured ${METRICS[i % 10]} against ${METRICS[(i * 3 + 1) % 10]} over ${((i * 7) % 50) + 3} merchant questions.`,
  ).join(' ')}`;
const assistantWriteUp = (title = 'Merchant help assistant write-up') =>
  `${title}\n${Array.from(
    { length: 40 },
    (_, i) =>
      `Release ${i + 1} of the assistant answered ${i * 11 + 40} merchants about refunds, cutting the handover rate by ${(i % 9) + 2} points.`,
  ).join(' ')}`;

const document = (
  candidateId: string,
  text: string,
  kind: RecordEvidenceInput['source']['kind'] = 'document',
): RecordEvidenceInput => ({
  ...repository(candidateId, { provenance: 'submitted', strength: 'medium', competencies: [] }),
  source: {
    kind,
    label: text.split('\n')[0] ?? 'Write-up',
    url: null,
    blobFileId: null,
    capturedAt: NOW,
    checkedAt: null,
    checkMethod: null,
  },
  text,
});

describe('AIV-P1-071: fingerprints and near-duplicate flags', () => {
  let maria: string;
  let omar: string;
  let mariaSource: string;
  let omarSource: string;
  let logged = '';

  beforeAll(async () => {
    maria = await person(w1, 'Maria Santos');
    omar = await person(w1, 'Omar Al Suwaidi');
    ({ sourceId: mariaSource } = await as(ALEX, w1, (ctx) =>
      evidence.recordEvidence(ctx, document(maria, harnessWriteUp())),
    ));
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (written.push(String(chunk)), true));
    try {
      const edited = harnessWriteUp('How we evaluate retrieval')
        .replace('In week 3 the harness measured', 'During the third week we checked')
        .replace('over 38 merchant questions', 'across 38 support questions');
      ({ sourceId: omarSource } = await as(ALEX, w1, (ctx) => evidence.recordEvidence(ctx, document(omar, edited))));
    } finally {
      spy.mockRestore();
    }
    logged = written.join('');
  });

  it('the migration adds text_fingerprint with a 16-hex-character check constraint', async () => {
    await expect(
      withWorkspace(app, w1, (tx) =>
        tx.execute(sql`update evidence.source set text_fingerprint = 'not-a-fingerprint' where id = ${mariaSource}`),
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'source_text_fingerprint_check' });
  });

  describe('Scenario: Near-identical submissions from two applicants are flagged on both profiles', () => {
    it('both candidates see one flag citing the other source by its opaque id, at least 0.92 alike', async () => {
      for (const candidate of [maria, omar]) {
        const flags = await as(ALEX, w1, (ctx) => evidence.listDuplicateFlags(ctx, candidate));
        expect(flags).toEqual([
          expect.objectContaining({
            sourceId: omarSource,
            candidateId: omar,
            otherSourceId: mariaSource,
            otherCandidateId: maria,
            resolution: null,
          }),
        ]);
        expect(flags[0]?.similarity).toBeGreaterThanOrEqual(NEAR_DUPLICATE_THRESHOLD);
      }
    });

    it("neither candidate's evidence changes: the items keep their provenance and strength", async () => {
      for (const candidate of [maria, omar])
        expect(
          (await as(ALEX, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, candidate, JOB))).map((i) => [
            i.provenance,
            i.strength,
          ]),
        ).toEqual([['submitted', 'medium']]);
    });
  });

  describe('Scenario: The flag is never shared across workspaces', () => {
    // SAFETY: mutation check: ALTER POLICY source_tenant_isolation USING (true) WITH CHECK (true), repository filter kept -> this test failed (W2 saw W1's sources); dropping the policy under FORCE hides every row instead, so the loosened policy is the real mutation
    it("an identical write-up in Gulf Talent Partners raises no flag, and W2 cannot see W1's sources even with no WHERE clause", async () => {
      const gulf = await person(w2, 'Arjun Menon');
      const { sourceId } = await as(ALEX, w2, (ctx) => evidence.recordEvidence(ctx, document(gulf, harnessWriteUp())));
      expect(await as(ALEX, w2, (ctx) => evidence.listDuplicateFlags(ctx, gulf))).toEqual([]);
      expect(await as(ALEX, w1, (ctx) => evidence.listDuplicateFlags(ctx, maria))).toHaveLength(1);
      const seen = await withWorkspace(app, w2, (tx) =>
        tx.execute<{ id: string }>(sql`select id from evidence.source where text_fingerprint is not null`),
      );
      expect([...seen].map((r) => r.id)).toEqual([sourceId]);
    });
  });

  describe('Scenario Outline: Text without enough signal is not fingerprinted', () => {
    it.each(['Python, SQL, Docker', 'Sara Al Qahtani · sara@example.com · Dubai', 'Experience Education Skills'])(
      '"%s" gets no fingerprint and never matches',
      async (text) => {
        const paolo = await person(w1, `Paolo Garcia ${text.length}`);
        await as(ALEX, w1, (ctx) => evidence.recordEvidence(ctx, document(paolo, text)));
        await as(ALEX, w1, (ctx) => evidence.recordEvidence(ctx, document(omar, text)));
        const [listed] = await as(ALEX, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, paolo, JOB));
        expect(listed?.source.textFingerprint).toBeNull();
        expect(await as(ALEX, w1, (ctx) => evidence.listDuplicateFlags(ctx, paolo))).toEqual([]);
      },
    );
  });

  describe('Scenario: The same document uploaded twice by one candidate is one origin', () => {
    it("Sara's document and her portal re-upload under a new title form one origin, with no flag", async () => {
      const first = await as(ALEX, w1, (ctx) => evidence.recordEvidence(ctx, document(sara, assistantWriteUp())));
      const again = await as(ALEX, w1, (ctx) =>
        evidence.recordEvidence(
          ctx,
          document(sara, assistantWriteUp('Refunds assistant, final version'), 'portal_submission'),
        ),
      );
      const origins = await as(ALEX, w1, (ctx) => evidence.listOriginGroups(ctx, sara));
      expect(origins.find((g) => g.includes(first.sourceId))).toEqual([first.sourceId, again.sourceId]);
      expect(await as(ALEX, w1, (ctx) => evidence.listDuplicateFlags(ctx, sara))).toEqual([]);
    });
  });

  describe("Scenario: Resolving the flag is a person's decision and is audited", () => {
    it('"Shared group project" shows on both candidates, the audit log records who, when and why, and nothing is sent', async () => {
      const [flag] = await as(ALEX, w1, (ctx) => evidence.listDuplicateFlags(ctx, maria));
      const events = await count(w1, 'outbox');
      await as(ALEX, w1, (ctx) => evidence.resolveDuplicateFlag(ctx, flag?.id ?? '', 'shared_group_project'));
      for (const candidate of [maria, omar])
        expect(await as(ALEX, w1, (ctx) => evidence.listDuplicateFlags(ctx, candidate))).toMatchObject([
          { resolution: 'shared_group_project', resolvedBy: ALEX, resolvedAt: NOW },
        ]);
      expect(await audit.listFor(w1, { type: 'duplicate_flag', id: flag?.id ?? '' })).toMatchObject([
        {
          action: 'evidence.flag_resolved',
          actor: { type: 'user', id: ALEX },
          after: { resolution: 'shared_group_project', sourceId: omarSource, otherSourceId: mariaSource },
        },
      ]);
      expect(await count(w1, 'outbox')).toBe(events);
    });
  });

  // SAFETY: mutation check: removed the pg_advisory_xact_lock from the store's fingerprints -> this test failed (no flag)
  it('two copies recorded at the same time still flag each other', async () => {
    const pool = createDb(urlFor('aivera_app'), { max: 2 });
    try {
      const audit2 = createAudit(pool);
      const ws = createWorkspaces(pool, audit2);
      const ev = createEvidence(ws, audit2, () => NOW);
      const [a, b] = [await person(w1, 'Huda Rahman'), await person(w1, 'Farid Haddad')];
      const text = assistantWriteUp('Refunds assistant notes, shared copy').replaceAll('assistant', 'helper');
      await Promise.all(
        [a, b].map((c) => ws.withWorkspace({ userId: ALEX }, w1, (ctx) => ev.recordEvidence(ctx, document(c, text)))),
      );
      expect(await as(ALEX, w1, (ctx) => evidence.listDuplicateFlags(ctx, a))).toHaveLength(1);
    } finally {
      await pool.$client.end();
    }
  });

  describe('Scenario: Interviewers cannot resolve the flag', () => {
    // SAFETY: mutation check: removed authorize(ctx, 'candidate.create') from resolveDuplicateFlag -> this test failed (no ForbiddenError)
    it('Lina, an interviewer, gets 403 and the flag is unchanged', async () => {
      const [before] = await as(ALEX, w1, (ctx) => evidence.listDuplicateFlags(ctx, maria));
      await expect(
        as(LINA, w1, (ctx) => evidence.resolveDuplicateFlag(ctx, before?.id ?? '', 'needs_follow_up')),
      ).rejects.toThrow(ForbiddenError);
      await expect(as(LINA, w1, (ctx) => evidence.listDuplicateFlags(ctx, maria))).rejects.toThrow(ForbiddenError);
      expect(await as(ALEX, w1, (ctx) => evidence.listDuplicateFlags(ctx, maria))).toEqual([before]);
    });
  });

  describe('Scenario: No excerpt or name reaches logs', () => {
    // SAFETY: mutation check: logFlagged also passed the source label and redact() was removed from the logger -> this test failed (the redactor alone already hides an unlisted key)
    it('the flag is logged with source ids and the similarity only', () => {
      const lines = logged
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      const line = lines.find((l) => l.msg === 'evidence near-duplicate flagged');
      expect(line).toMatchObject({ sourceId: omarSource, otherSourceId: mariaSource });
      expect(line?.['credalent.evidence.similarity']).toBeGreaterThanOrEqual(NEAR_DUPLICATE_THRESHOLD);
      for (const leak of ['Maria', 'Omar', 'Suwaidi', 'example.com', 'harness', 'retrieval', 'https://'])
        expect(logged.toLowerCase()).not.toContain(leak.toLowerCase());
    });
  });
});

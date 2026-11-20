import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AuditContract } from '@credalent/audit';
import { createAudit } from '@credalent/audit/composition';
import { createDb, withWorkspace, type Db } from '@credalent/db';
import type { EvidenceContract, RecordEvidenceInput, RequestOutcome } from '@credalent/evidence';
import { createEvidence, createRequestOutcomeRecorder } from '@credalent/evidence/composition';
import type { WorkspaceContext, WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P1-037 against real PostgreSQL, connected as the non-owner aivera_app role (ADR-004, ADR-005). Synthetic cast only.

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1';
const SARA = '0190d4a2-0000-7000-8000-00000000c001';
const HESSA = '0190d4a2-0000-7000-8000-00000000c002';
const NOW = new Date('2026-11-20T09:00:00.000Z');
// Opaque ids of the jobs module: Senior AI Engineer and three of its competencies.
const JOB = '0190d4a2-0000-7000-8000-000000000b01';
const LLM = '0190d4a2-0000-7000-8000-0000000c0e01';
const COST = '0190d4a2-0000-7000-8000-0000000c0e02';
const ARABIC = '0190d4a2-0000-7000-8000-0000000c0e03';

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let workspaces: WorkspacesContract;
let audit: AuditContract;
let evidence: EvidenceContract;
// The system's path (the follow-up worker, the portal): a workspace-scoped transaction with no member.
const recordOutcome = (workspaceId: string, requestId: string, outcome: RequestOutcome) =>
  withWorkspace(app, workspaceId, (tx) => createRequestOutcomeRecorder(() => NOW)(tx, workspaceId, requestId, outcome));
let w1: string;
let w2: string;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const as = <T>(workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId: ALEX }, workspaceId, fn);

const record = (
  candidateId: string,
  excerpt: string,
  provenance: 'claim' | 'awaiting-defence' | 'corroborated',
  competencyId: string,
): RecordEvidenceInput => ({
  candidateId,
  source: {
    kind: provenance === 'corroborated' ? 'repository' : 'cv',
    label: provenance === 'corroborated' ? 'checkout-e2e' : 'CV',
    url: provenance === 'corroborated' ? 'https://code.credalent.example/hessa/checkout-e2e' : null,
    blobFileId: null,
    capturedAt: new Date('2026-11-10T08:00:00.000Z'),
    checkedAt: null,
    checkMethod: null,
  },
  items: [
    {
      excerpt,
      excerptSpan: provenance === 'corroborated' ? null : 'page 2',
      provenance,
      strength: provenance === 'corroborated' ? 'strong' : 'supporting',
      limit: 'Synthetic limit statement.',
      competencies: [{ jobId: JOB, competencyId, level: 4 }],
    },
  ],
  synthetic: true,
});

const outboxTypes = async (workspaceId: string) =>
  (
    await withWorkspace(app, workspaceId, (tx) =>
      tx.execute<{ type: string }>(
        sql`select type from evidence.outbox where type like 'EvidenceRequest%' order by type`,
      ),
    )
  ).map((r) => r.type);

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
  evidence = createEvidence(workspaces, audit, () => NOW);
  const create = async (name: string) =>
    (await workspaces.createWorkspace({ name, company: name, hiringFocus: 'AI', synthetic: true, creatorUserId: ALEX }))
      .id;
  w1 = await create('Demo hiring team');
  w2 = await create('Gulf Talent Partners');
  await as(w1, async (ctx) => {
    await evidence.recordEvidence(ctx, record(SARA, 'used by about 9,000 merchants', 'corroborated', LLM));
    await evidence.recordEvidence(ctx, record(SARA, 'cut cost per request by 40%', 'claim', COST));
    await evidence.recordEvidence(ctx, record(SARA, 'built a Gulf Arabic evaluation set', 'awaiting-defence', ARABIC));
    await evidence.recordEvidence(ctx, record(HESSA, 'wrote 148 of 171 test cases', 'corroborated', LLM));
  });
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

describe('Migrations', () => {
  it('request tables are owned by aivera_migrator with row-level security enabled and forced', async () => {
    const tables = await admin.execute<{ name: string; owner: string; rls: boolean; forced: boolean }>(sql`
      select t.tablename as name, t.tableowner as owner, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_tables t join pg_class c on c.oid = format('%I.%I', t.schemaname, t.tablename)::regclass
      where t.schemaname = 'evidence' and t.tablename in ('request', 'request_item', 'portal_token') order by name`);
    expect([...tables]).toEqual(
      ['portal_token', 'request', 'request_item'].map((name) => ({
        name,
        owner: 'aivera_migrator',
        rls: true,
        forced: true,
      })),
    );
  });
});

describe('Scenario: A draft names only open claims, with the default follow-up policy', () => {
  it("Sara's draft has exactly her 2 open claims and follows up after 2 days, at most twice; it is audited", async () => {
    const draft = await as(w1, (ctx) => evidence.createDraftRequest(ctx, { candidateId: SARA, jobId: JOB }));
    expect(draft.items.map((i) => i.competencyId).toSorted()).toEqual([COST, ARABIC].toSorted());
    expect(draft).toMatchObject({ status: 'draft', followUpAfterDays: 2, followUpMaxCount: 2, sentAt: null });
    expect(await as(w1, (ctx) => evidence.getRequest(ctx, draft.id))).toMatchObject({ status: 'draft' });
    const entries = await audit.listFor(w1, { type: 'evidence_request', id: draft.id });
    expect(entries.map((e) => [e.action, e.after])).toEqual([
      ['evidence_request.created', { candidateId: SARA, jobId: JOB, items: 2 }],
    ]);
    // One open request per candidate per job: the partial unique index refuses a second, mapped to the domain error.
    await expect(as(w1, (ctx) => evidence.createDraftRequest(ctx, { candidateId: SARA, jobId: JOB }))).rejects.toThrow(
      'This candidate already has an open request for this job',
    );
  });
});

describe('Scenario: Nothing to request', () => {
  it('Hessa has no open claims: "Nothing rests on a claim for this job" and no draft is created', async () => {
    await expect(as(w1, (ctx) => evidence.createDraftRequest(ctx, { candidateId: HESSA, jobId: JOB }))).rejects.toThrow(
      'Nothing rests on a claim for this job',
    );
    const [row] = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from evidence.request where candidate_id = ${HESSA}`),
    );
    expect(row?.n).toBe(0);
  });
});

describe('Scenario: Only a person can send', () => {
  it('the system recording "sent" is refused and the status stays draft; a person sends, with a hashed token', async () => {
    const [draft] = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ id: string }>(sql`select id from evidence.request where candidate_id = ${SARA}`),
    );
    const id = draft?.id ?? '';
    await expect(recordOutcome(w1, id, 'sent' as RequestOutcome)).rejects.toThrow(
      'This request cannot move to that status',
    );
    await expect(recordOutcome(w1, id, 'opened')).rejects.toThrow('This request cannot move to that status');
    expect(await as(w1, (ctx) => evidence.getRequest(ctx, id))).toMatchObject({ status: 'draft', sentAt: null });
    expect(await outboxTypes(w1)).toEqual([]);

    const { request, portalToken } = await as(w1, (ctx) => evidence.sendRequest(ctx, id));
    expect(request).toMatchObject({ status: 'sent', sentAt: NOW });
    const tokens = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ hash: string; expires: string }>(
        sql`select token_hash as hash, to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') as expires from evidence.portal_token where request_id = ${id}`,
      ),
    );
    // Stored hashed: the row holds the SHA-256 of the token, never the token itself.
    expect([...tokens]).toEqual([
      { hash: createHash('sha256').update(portalToken).digest('hex'), expires: '2026-12-20T09:00' },
    ]);
    expect(tokens[0]?.hash).not.toContain(portalToken);
    await expect(as(w1, (ctx) => evidence.sendRequest(ctx, id))).rejects.toThrow(
      'This request cannot move to that status',
    );

    await recordOutcome(w1, id, 'opened');
    await recordOutcome(w1, id, 'answered');
    expect(await outboxTypes(w1)).toEqual([
      'EvidenceRequestAnswered.v1',
      'EvidenceRequestOpened.v1',
      'EvidenceRequestSent.v1',
    ]);
    await as(w1, (ctx) => evidence.closeRequest(ctx, id));
    expect((await audit.listFor(w1, { type: 'evidence_request', id })).map((e) => e.action)).toEqual([
      'evidence_request.created',
      'evidence_request.sent',
      'evidence_request.closed',
    ]);
  });
});

describe('Invariants the database enforces', () => {
  it('a draft with a sent time, or a sent request without one, is refused', async () => {
    const [row] = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ id: string; status: string }>(sql`select id, status from evidence.request limit 1`),
    );
    expect(row?.id).toBeDefined();
    for (const change of [sql`status = 'draft', sent_at = now()`, sql`status = 'sent', sent_at = null`])
      await expect(
        withWorkspace(app, w1, (tx) =>
          tx.execute(sql`update evidence.request set ${change} where id = ${row?.id ?? ''}`),
        ),
      ).rejects.toThrow('request_sent_check');
  });
});

describe('Scenario: Requests are workspace-scoped', () => {
  // SAFETY: mutation check: ALTER POLICY request_tenant_isolation USING (true) WITH CHECK (true) -> this test failed (W2 saw W1's request)
  it('a request in W1 is not visible from W2, even with no WHERE clause', async () => {
    const [own] = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ id: string }>(sql`select id from evidence.request limit 1`),
    );
    expect(own?.id).toBeDefined();
    expect(await as(w2, (ctx) => evidence.getRequest(ctx, own?.id ?? ''))).toBeNull();
    for (const table of ['request', 'request_item', 'portal_token'])
      expect([
        ...(await withWorkspace(app, w2, (tx) =>
          tx.execute(sql`select * from ${sql.identifier('evidence')}.${sql.identifier(table)}`),
        )),
      ]).toEqual([]);
  });
});

describe('Scenario: The seed reset still purges a workspace holding requests', () => {
  // SAFETY: mutation check: removed the request delete from deleteSynthetic -> this test failed (foreign key on request_item)
  it('purgeSyntheticEvidence deletes requests, their items and tokens with the evidence', async () => {
    await as(w1, (ctx) => evidence.purgeSyntheticEvidence(ctx));
    for (const table of ['request', 'request_item', 'portal_token', 'item'])
      expect([
        ...(await withWorkspace(app, w1, (tx) =>
          tx.execute(sql`select * from ${sql.identifier('evidence')}.${sql.identifier(table)}`),
        )),
      ]).toEqual([]);
  });
});

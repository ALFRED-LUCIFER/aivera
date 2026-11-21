import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { evaluateCatalogue, recordedClient } from '@credalent/ai/evals';
import type { AuditContract } from '@credalent/audit';
import { createAudit } from '@credalent/audit/composition';
import { createDb, type Db } from '@credalent/db';
import { createConsumer, type Delivery } from '@credalent/db/consumer';
import { CatalogueError, type CatalogueEditor } from '@credalent/jobs';
import { createCatalogueEditor, createCatalogueEvalHandler } from '@credalent/jobs/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P2-048: the eval on a catalogue draft (ADR-013 point 12), on real PostgreSQL: the request through the jobs
// contract as server/operator.ts calls it, the worker job through createConsumer with recorded answers (no model call).
// Synthetic operators and catalogue text only.

const repo = join(import.meta.dirname, '..', '..', '..');
const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(repo, 'packages', 'db', 'src', 'cli.ts');

const PIA = '0190d4a2-0000-7000-8000-00000000a001';
const THEO = '0190d4a2-0000-7000-8000-00000000a002';
const NOW = new Date('2026-11-21T09:00:00.000Z');
const TOKENS = 4_321;

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let audit: AuditContract;
let editor: CatalogueEditor;
/** What each worker job's evaluate was given: the run's keys and the tokens left today. */
let calls: { domains: string[]; left: number }[] = [];
let answers: 'recorded' | 'unavailable' = 'recorded';

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const draft = async () => {
  const view = (await editor.getEditor()).draft;
  if (!view) throw new Error('no draft');
  return view;
};
const request = async (operator = PIA) => {
  const { version, revision } = await draft();
  return editor.requestEval(operator, { version, revision });
};
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof CatalogueError ? error.code : Promise.reject(error)),
  );

/** The newest CatalogueEvalRequested.v1 envelope in jobs.outbox, as the relay sends it. */
async function latestEnvelope() {
  const [row] = await admin.execute<{
    id: string;
    workspace_id: string;
    type: string;
    payload: unknown;
    occurred_at: Date;
  }>(sql`select id, workspace_id, type, payload, occurred_at from jobs.outbox
    where type = 'CatalogueEvalRequested.v1' order by occurred_at desc, id desc limit 1`);
  if (!row) throw new Error('no eval message');
  return {
    id: row.id,
    type: row.type,
    workspaceId: row.workspace_id,
    occurredAt: new Date(row.occurred_at).toISOString(),
    payload: row.payload,
    correlationId: null,
  };
}

const consumer = () =>
  createConsumer({
    db: app,
    queue: 'jobs',
    now: () => NOW,
    handlers: [
      createCatalogueEvalHandler({
        now: () => NOW,
        evaluate: async (keys, left) => {
          calls.push({ domains: keys.domains, left });
          if (answers === 'unavailable') return { outcome: 'unavailable', uncovered: [], tasks: [], tokens: 12 };
          return { ...(await evaluateCatalogue(recordedClient(), keys)), tokens: TOKENS };
        },
      }),
    ],
  });

/** Delivers `body` once and returns how it was settled. */
async function deliver(body: unknown) {
  const settled: string[] = [];
  const delivery: Delivery = {
    body,
    deliveryCount: 1,
    complete: async () => void settled.push('complete'),
    abandon: async () => void settled.push('abandon'),
    deadLetter: async (reason) => void settled.push(`deadLetter: ${reason}`),
  };
  await consumer().handle(delivery);
  return settled;
}

const runs = () =>
  admin.execute<{ status: string; tokens: number; finished_at: Date | null }>(
    sql`select status, tokens, finished_at from jobs.catalogue_eval_run order by requested_at, id`,
  );

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 2 });
  audit = createAudit(app, () => NOW);
  editor = createCatalogueEditor(app, audit, () => NOW);
  await editor.openDraft(PIA);
});

afterAll(async () => {
  await Promise.all([app?.$client.end(), admin?.$client.end()]);
  await container?.stop();
});

describe('Feature: Run the eval set on a catalogue draft', () => {
  it('no run yet: the state is not run, and no draft means no state', async () => {
    expect(await editor.getDraftEval()).toEqual({ status: 'not_run' });
  });

  it('Scenario: A passing run is recorded against the draft content', async () => {
    const { version, revision } = await draft();
    await editor.saveDraftPack(THEO, { version, revision, previousKey: 'telecom', key: 'telecom', label: 'Telecoms' });
    await request();
    expect(await editor.getDraftEval()).toEqual({ status: 'running', requestedAt: NOW });
    const [entry] = (await audit.listPlatformEntries({})).entries;
    expect(entry).toMatchObject({
      action: 'catalogue.eval_requested',
      actorId: PIA,
      after: { catalogueVersion: 2, revision: revision + 1 },
    });
    const envelope = await latestEnvelope();
    expect(envelope.workspaceId).toBe('0190d4a2-0000-7000-8000-0000000e7a1e');

    expect(await deliver(envelope)).toEqual(['complete']);
    const state = await editor.getDraftEval();
    expect(state).toMatchObject({ status: 'passed', finishedAt: NOW, tokens: TOKENS });
    if (state?.status !== 'passed') throw new Error('not passed');
    expect(state.result.tasks.map((t) => t.task)).toEqual(['jobs.detectDomain', 'jobs.draftCompetencies']);
    expect(state.result.tasks[0]?.groups.map((g) => g.group)).toEqual(['domain', 'none', 'fairness']);
    // The keys sent are the draft's own, fixed at the request.
    expect(calls).toEqual([{ domains: (await draft()).packs.map((p) => p.key), left: 1_500_000 }]);
  });

  it('Scenario: Retries are idempotent: a redelivered message for the same run records one result', async () => {
    const before = [...(await runs())];
    expect(await deliver(await latestEnvelope())).toEqual(['complete']);
    expect([...(await runs())]).toEqual(before);
    expect(calls).toHaveLength(1);
  });

  it('Scenario: An edit after the run invalidates it', async () => {
    const { version, revision } = await draft();
    await editor.saveDraftPack(THEO, { version, revision, previousKey: 'telecom', key: 'telecom', label: 'Telecom' });
    expect(await editor.getDraftEval()).toEqual({ status: 'stale', finishedAt: NOW });
  });

  it('Scenario: Runs do not overlap: a second request while one runs is refused', async () => {
    await request();
    expect(await outcome(request(THEO))).toBe('eval_running');
    // A request on an older revision is stale, like any save.
    const { version, revision } = await draft();
    expect(await outcome(editor.requestEval(PIA, { version, revision: revision - 1 }))).toBe('stale');
  });

  it('Scenario: The AI deployment is unavailable: the run could not run and the draft is unchanged', async () => {
    const before = await draft();
    answers = 'unavailable';
    expect(await deliver(await latestEnvelope())).toEqual(['complete']);
    answers = 'recorded';
    expect(await editor.getDraftEval()).toEqual({ status: 'error', requestedAt: NOW });
    expect(await draft()).toEqual(before);
    // The day's eval budget counts what earlier runs spent.
    expect(calls.at(-1)?.left).toBe(1_500_000 - TOKENS);
  });

  it('Scenario: A new pack without golden cases cannot pass', async () => {
    const { version, revision } = await draft();
    await editor.saveDraftPack(PIA, { version, revision, previousKey: null, key: 'insurance', label: 'Insurance' });
    await request();
    await deliver(await latestEnvelope());
    const state = await editor.getDraftEval();
    expect(state).toMatchObject({ status: 'failed', result: { uncovered: ['insurance'], tasks: [] } });
  });

  it('a run lost past its timeout no longer blocks a new one, and ends as an error', async () => {
    await admin.execute(sql`insert into jobs.catalogue_eval_run
      (id, version, content_hash, keys, status, requested_by, requested_at)
      values ('f0000000-0000-7000-8000-000000000001', 2, ${'0'.repeat(64)}, '{"domains":[],"regions":[]}', 'running',
        ${PIA}, ${NOW.toISOString()})`);
    expect(await outcome(request())).toBe('eval_running');
    const later = createCatalogueEditor(app, audit, () => new Date(NOW.getTime() + 31 * 60_000));
    expect(await later.getDraftEval()).toEqual({ status: 'error', requestedAt: NOW });
    const { version, revision } = await draft();
    expect(await outcome(later.requestEval(PIA, { version, revision }))).toBe('ok');
    const statuses = [...(await runs())].map((r) => r.status);
    expect(statuses.filter((s) => s === 'running')).toHaveLength(1);
    expect(statuses).toContain('error');
  });

  it('the database allows one running run per draft', async () => {
    await expect(
      admin.execute(sql`insert into jobs.catalogue_eval_run
        (id, version, content_hash, keys, status, requested_by, requested_at)
        values (gen_random_uuid(), 2, ${'0'.repeat(64)}, '{"domains":[],"regions":[]}', 'running', ${PIA}, now())`),
    ).rejects.toThrow();
  });

  // SAFETY: mutation check: latestRun read only passed runs (any passed run on the hash) -> this test failed (passed)
  it('only the latest run counts: an older pass on the same content does not outweigh a newer failure', async () => {
    await deliver(await latestEnvelope());
    expect((await editor.getDraftEval())?.status).toBe('failed');
    await admin.execute(sql`insert into jobs.catalogue_eval_run
      (id, version, content_hash, keys, status, requested_by, requested_at, finished_at, result)
      select gen_random_uuid(), version, content_hash, keys, 'passed', requested_by, ${'2026-11-20T09:00:00.000Z'},
        ${'2026-11-20T09:05:00.000Z'}, '{"uncovered":[],"tasks":[]}'
      from jobs.catalogue_eval_run where status = 'failed' order by requested_at desc limit 1`);
    expect((await editor.getDraftEval())?.status).toBe('failed');
  });

  it('a run a worker still holds is not abandoned, even past its timeout', async () => {
    const later = createCatalogueEditor(app, audit, () => new Date(NOW.getTime() + 62 * 60_000));
    const { version, revision } = await draft();
    await later.requestEval(PIA, { version, revision });
    // A worker holds the run's row in its transaction while the request comes in after the timeout.
    const { promise: held, resolve: release } = Promise.withResolvers<void>();
    const worker = admin.transaction(async (tx) => {
      await tx.execute(sql`select id from jobs.catalogue_eval_run where status = 'running' for update`);
      await held;
    });
    const muchLater = createCatalogueEditor(app, audit, () => new Date(NOW.getTime() + 93 * 60_000));
    expect(await outcome(muchLater.requestEval(PIA, { version, revision }))).toBe('eval_running');
    release();
    await worker;
  });
});

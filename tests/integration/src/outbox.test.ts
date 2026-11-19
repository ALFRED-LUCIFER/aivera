import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createAudit } from '@aivera/audit/composition';
import { PersonCreatedV1, type CandidatesContract, type FindOrCreatePersonInput } from '@aivera/candidates';
import { createCandidates } from '@aivera/candidates/composition';
import { createDb, enqueue, outboxTable, uuidv7, withWorkspace, type Db, type Envelope } from '@aivera/db';
import { createRelay, type RelayPorts } from '@aivera/db/relay';
import type { WorkspaceContext, WorkspacesContract } from '@aivera/workspaces';
import { createWorkspaces } from '@aivera/workspaces/composition';
import { sql } from 'drizzle-orm';
import { pgSchema } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// AIV-P0-014 acceptance scenarios against real PostgreSQL: the app writes as aivera_app (row-level security applies),
// the relay reads as aivera_relay. Service Bus is a fake sender that records what it accepted. Synthetic cast only.

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@aivera/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1';
const NOW = new Date('2026-11-18T09:00:00.000Z');
const outbox = outboxTable(pgSchema('candidates'));
const spans = new InMemorySpanExporter();

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let relayDbs: Db[];
let workspaces: WorkspacesContract;
let candidates: CandidatesContract;
let w1: string;
let w2: string;
let clock: Date;
let sent: { queue: string; envelope: Envelope }[];

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const as = <T>(workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId: ALEX }, workspaceId, fn);

let n = 0;
const person = (): FindOrCreatePersonInput => ({
  displayName: 'Sara Al Qahtani',
  identifiers: [{ type: 'email', value: `sara.alqahtani+${++n}@example.com` }],
  synthetic: true,
});

const relay = (overrides: Partial<RelayPorts> = {}) =>
  createRelay({
    db: relayDbs[0] as Db,
    schemas: ['candidates'],
    queueFor: (type) => (type === PersonCreatedV1.type ? 'candidates' : undefined),
    send: async (queue, envelope) => void sent.push({ queue, envelope }),
    now: () => clock,
    ...overrides,
  });

const rows = () =>
  admin.execute<{ id: string; workspace_id: string; attempts: number; sent_at: string | null }>(
    sql`select id, workspace_id, attempts, sent_at from candidates.outbox order by id`,
  );

/** Enqueues `count` PersonCreated.v1 events straight through the outbox helper, as a module would. */
const enqueueMany = (count: number) =>
  withWorkspace(app, w1, async (tx) => {
    for (let i = 0; i < count; i++) {
      const personId = uuidv7();
      await enqueue(tx, outbox, PersonCreatedV1, {
        workspaceId: w1,
        payload: { personId },
        dedupeKey: `person:${personId}`,
        occurredAt: NOW,
      });
    }
  });

beforeAll(async () => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] }));

  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 1 });
  relayDbs = [createDb(urlFor('aivera_relay'), { max: 1 }), createDb(urlFor('aivera_relay'), { max: 1 })];
  workspaces = createWorkspaces(app, createAudit(app));
  candidates = createCandidates(workspaces, () => NOW);
  const newWorkspace = async (name: string) =>
    (await workspaces.createWorkspace({ name, company: name, hiringFocus: 'AI', synthetic: true, creatorUserId: ALEX }))
      .id;
  w1 = await newWorkspace('Demo Hiring Co');
  w2 = await newWorkspace('Gulf Talent Partners');
});

beforeEach(async () => {
  // Every scenario starts with nothing waiting (admin is the container superuser, outside row-level security).
  await admin.execute(sql`update candidates.outbox set sent_at = now() where sent_at is null`);
  clock = new Date(NOW.getTime() + 1000);
  sent = [];
  spans.reset();
});

afterAll(async () => {
  await Promise.all([app, admin, ...(relayDbs ?? [])].map((db) => db?.$client.end()));
  await container?.stop();
  trace.disable();
  propagation.disable();
  context.disable();
});

describe('Scenario: An event is sent after its change commits', () => {
  it('creating a person writes PersonCreated.v1 to candidates.outbox, and one relay pass sends and marks it', async () => {
    const before = (await rows()).length;
    const { personId, actionSpan } = await trace
      .getTracer('test')
      .startActiveSpan('action createPerson', async (span) => {
        const result = await as(w1, (ctx) => candidates.findOrCreatePerson(ctx, person()));
        span.end();
        return { personId: result.personId, actionSpan: span.spanContext() };
      });

    const [row] = await admin.execute<{ id: string; type: string; payload: unknown; correlation_id: string }>(
      sql`select id, type, payload, correlation_id from candidates.outbox where sent_at is null`,
    );
    expect((await rows()).length).toBe(before + 1);
    expect(row).toMatchObject({ type: 'PersonCreated.v1', payload: { personId } });
    expect(row?.correlation_id).toBe(`00-${actionSpan.traceId}-${actionSpan.spanId}-01`);

    expect(await relay()()).toEqual({ sent: 1, failed: 0 });
    expect(sent).toEqual([
      {
        queue: 'candidates',
        envelope: {
          id: row?.id,
          type: 'PersonCreated.v1',
          workspaceId: w1,
          occurredAt: NOW.toISOString(),
          payload: { personId },
          correlationId: row?.correlation_id,
        },
      },
    ]);
    expect((await rows()).find((r) => r.id === row?.id)?.sent_at).not.toBeNull();

    // One trace from the server action through the relay (the worker handler hop: worker.test.ts).
    const relaySpan = spans.getFinishedSpans().find((s) => s.name === 'outbox.relay PersonCreated.v1');
    expect(relaySpan?.spanContext().traceId).toBe(actionSpan.traceId);
    expect(relaySpan?.parentSpanContext?.spanId).toBe(actionSpan.spanId);
  });

  it('a second pass sends nothing more', async () => {
    await as(w1, (ctx) => candidates.findOrCreatePerson(ctx, person()));
    await relay()();
    expect(await relay()()).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(1);
  });
});

describe('Scenario: A rolled-back change sends nothing', () => {
  // SAFETY: mutation check: enqueue committed on its own (`commit` after its insert) -> this test failed (row left behind)
  it('a transaction that fails after the enqueue leaves no outbox row and no message', async () => {
    const before = (await rows()).length;
    await expect(
      as(w1, async (ctx) => {
        await candidates.findOrCreatePerson(ctx, person());
        throw new Error('approval failed after enqueue');
      }),
    ).rejects.toThrow('approval failed after enqueue');
    expect((await rows()).length).toBe(before);
    expect(await relay()()).toEqual({ sent: 0, failed: 0 });
  });
});

describe('Scenario: Service Bus is down', () => {
  it('the row stays unsent, is retried after its back-off, and is sent once Service Bus is back', async () => {
    let up = false;
    const flaky = relay({
      send: async (queue, envelope) => {
        if (!up) throw new Error('ServiceUnavailable');
        sent.push({ queue, envelope });
      },
    });
    const { personId } = await as(w1, (ctx) => candidates.findOrCreatePerson(ctx, person()));

    expect(await flaky()).toEqual({ sent: 0, failed: 1 });
    const [row] = await admin.execute<{ attempts: number; next_attempt_at: Date; sent_at: Date | null }>(
      sql`select attempts, next_attempt_at, sent_at from candidates.outbox where payload->>'personId' = ${personId}`,
    );
    expect(row).toMatchObject({ attempts: 1, sent_at: null });
    expect(new Date(row?.next_attempt_at ?? 0).getTime()).toBe(clock.getTime() + 1000);

    up = true;
    // Not due yet: the back-off holds it back even though Service Bus answers again.
    expect(await flaky()).toEqual({ sent: 0, failed: 0 });
    clock = new Date(clock.getTime() + 1000);
    expect(await flaky()).toEqual({ sent: 1, failed: 0 });
    expect(sent.map((s) => s.envelope.payload)).toEqual([{ personId }]);
  });
});

describe('Scenario: Service Bus is down, with a batch waiting', () => {
  // SAFETY: mutation check: removed the `break` after a refused send in relayOnce -> this test failed (three sends tried)
  it('stops at the first refused send and holds the rest of the batch back as long, unattempted', async () => {
    await enqueueMany(3);
    let tries = 0;
    const down = relay({
      send: async () => {
        tries++;
        throw new Error('ServiceUnavailable');
      },
    });
    expect(await down()).toEqual({ sent: 0, failed: 1 });
    expect(tries).toBe(1);
    const waiting = await admin.execute<{ attempts: number; next_attempt_at: Date }>(
      sql`select attempts, next_attempt_at from candidates.outbox where sent_at is null order by attempts desc`,
    );
    expect(waiting.map((r) => r.attempts)).toEqual([1, 0, 0]);
    expect(new Set(waiting.map((r) => new Date(r.next_attempt_at).getTime()))).toEqual(
      new Set([clock.getTime() + 1000]),
    );
  });
});

describe('An event type with no queue', () => {
  // SAFETY: mutation check: made an unmapped type stop the pass like a refused send -> this test failed (sent 0)
  it('fails alone and is retried, while the rest of the batch is sent', async () => {
    const Unmapped = { type: 'Unmapped.v1', payload: PersonCreatedV1.payload };
    await withWorkspace(app, w1, (tx) =>
      enqueue(tx, outbox, Unmapped, {
        workspaceId: w1,
        payload: { personId: uuidv7() },
        dedupeKey: `unmapped:${uuidv7()}`,
        occurredAt: new Date(NOW.getTime() - 1000),
      }),
    );
    await enqueueMany(2);
    expect(await relay()()).toEqual({ sent: 2, failed: 1 });
    expect(sent.map((s) => s.envelope.type)).toEqual(['PersonCreated.v1', 'PersonCreated.v1']);
  });
});

describe('Scenario: Two relay instances never double-send', () => {
  // SAFETY: mutation check: removed `.for('update', { skipLocked: true })` from the relay's claim -> this test failed (events sent twice)
  it('100 events across two relays are each sent exactly once, with the event id as message id', async () => {
    await enqueueMany(100);
    const ids = (await rows()).filter((r) => r.sent_at === null).map((r) => r.id);
    const slowSend: RelayPorts['send'] = async (queue, envelope) => {
      await sleep(2);
      sent.push({ queue, envelope });
    };
    const drain = async (db: Db) => {
      const once = relay({ db, send: slowSend, batchSize: 10 });
      while ((await once()).sent > 0);
    };
    await Promise.all(relayDbs.map(drain));

    expect(sent).toHaveLength(100);
    expect(sent.map((s) => s.envelope.id).toSorted()).toEqual(ids.toSorted());
    expect((await rows()).every((r) => r.sent_at !== null)).toBe(true);
  });

  // SAFETY: mutation check: replaced `{ skipLocked: true }` with a plain FOR UPDATE -> this test failed (the second relay waited)
  it('a relay does not wait for rows another relay has claimed; it sends the next ones', async () => {
    await enqueueMany(20);
    const held = Promise.withResolvers<void>();
    const claimed = Promise.withResolvers<void>();
    const first = relay({
      batchSize: 10,
      send: async () => {
        claimed.resolve();
        await held.promise;
      },
    })();
    await claimed.promise;

    const second = relay({ db: relayDbs[1] as Db, batchSize: 10 })();
    const outcome = await Promise.race([second, sleep(3000, 'blocked')]);
    held.resolve();
    expect(outcome).toEqual({ sent: 10, failed: 0 });
    expect(await first).toEqual({ sent: 10, failed: 0 });
    await second;
  });
});

describe('Outbox row-level security and roles (ADR-005)', () => {
  beforeAll(async () => {
    await as(w2, (ctx) => candidates.findOrCreatePerson(ctx, person()));
  });

  // SAFETY: mutation check: outbox_tenant_isolation USING (true) in 0002_outbox.sql -> this test failed (W1 saw W2's rows)
  it("the app in W1 reads only W1's events with no WHERE clause, and none with no workspace set", async () => {
    const seen = await withWorkspace(app, w1, (tx) => tx.select({ workspaceId: outbox.workspaceId }).from(outbox));
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen.map((r) => r.workspaceId))).toEqual(new Set([w1]));
    expect(await app.select().from(outbox)).toEqual([]);
  });

  // SAFETY: mutation check: removed the REVOKE from 0003_outbox_grants.sql -> this test failed (the update ran)
  it('the app cannot mark or delete events, so it cannot suppress one', async () => {
    await expect(
      withWorkspace(app, w1, (tx) => tx.execute(sql`update candidates.outbox set sent_at = now()`)),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(withWorkspace(app, w1, (tx) => tx.execute(sql`delete from candidates.outbox`))).rejects.toMatchObject({
      code: '42501',
    });
  });

  // SAFETY: mutation check: removed the policy outbox_relay_read from 0002_outbox.sql -> this test failed (the relay saw no rows)
  it("the relay, with no workspace set, reads every workspace's events", async () => {
    const seen = await (relayDbs[0] as Db).select({ workspaceId: outbox.workspaceId }).from(outbox);
    expect(new Set(seen.map((r) => r.workspaceId))).toEqual(new Set([w1, w2]));
  });

  // SAFETY: mutation check: granted aivera_relay SELECT on every candidates table and UPDATE on all outbox columns -> this test failed
  it('the relay reads no other table and changes nothing but the delivery columns', async () => {
    const relayDb = relayDbs[0] as Db;
    await expect(relayDb.execute(sql`select count(*) from candidates.person`)).rejects.toMatchObject({ code: '42501' });
    await expect(relayDb.execute(sql`update candidates.outbox set payload = '{}'`)).rejects.toMatchObject({
      code: '42501',
    });
    await expect(relayDb.execute(sql`delete from candidates.outbox`)).rejects.toMatchObject({ code: '42501' });
    await expect(relayDb.execute(sql`truncate candidates.outbox`)).rejects.toMatchObject({ code: '42501' });
    await expect(
      relayDb.insert(outbox).values({
        id: uuidv7(),
        workspaceId: w1,
        type: PersonCreatedV1.type,
        payload: {},
        dedupeKey: 'forged',
        occurredAt: NOW,
        nextAttemptAt: NOW,
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

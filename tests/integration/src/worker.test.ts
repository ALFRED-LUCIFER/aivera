import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { MeterProvider, MetricReader, type ResourceMetrics } from '@opentelemetry/sdk-metrics';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, inboxTable, newEnvelope, uuidv7, type Db, type Envelope, type EventDefinition } from '@credalent/db';
import type { Delivery, Handler } from '@credalent/db/consumer';
import { sql } from 'drizzle-orm';
import { pgSchema } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

// AIV-P0-015 acceptance scenarios for the consumer wrapper against real PostgreSQL as aivera_app (row-level security
// applies). Service Bus is a fake delivery that records how each message was settled.
// shortcut: no Service Bus emulator (it needs a SQL Server container); settlement and scheduling are faked at the SDK
// boundary here and in apps/worker/src/serviceBus.test.ts. Add the emulator when a consumer depends on broker behaviour.

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const W1 = '0190d4a2-0000-7000-8000-000000000001';
const W2 = '0190d4a2-0000-7000-8000-000000000002';
const NOW = new Date('2026-11-10T10:00:00.000Z');

// A test module schema with an inbox, as a consuming module's migrations create it (inboxTable's doc comment).
// The first real inbox (notifications, AIV-P0-017) is migration-backed and covered by the tenancy catalogue suite.
const inbox = inboxTable(pgSchema('worker_test'));
const AssessmentRequested: EventDefinition<{ applicationId: string }> = {
  type: 'AssessmentRequested.v1',
  payload: z.strictObject({ applicationId: z.uuid() }),
};

class TestReader extends MetricReader {
  protected override onForceFlush = async () => {};
  protected override onShutdown = async () => {};
}
const reader = new TestReader();
const spans = new InMemorySpanExporter();

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let createConsumer: typeof import('@credalent/db/consumer').createConsumer;
let runs: string[];
let failuresLeft: number;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const handler: Handler<{ applicationId: string }> = {
  event: AssessmentRequested,
  inbox,
  consumer: 'assessment.run',
  async handle(_tx, payload) {
    if (failuresLeft > 0) {
      failuresLeft--;
      throw new Error('timeout');
    }
    runs.push(payload.applicationId);
  },
};

const consumer = (signal?: AbortSignal) =>
  createConsumer({ db: app, queue: 'assessment', handlers: [handler], now: () => NOW, signal });

/** A fake Service Bus delivery that records its settlement. */
function delivery(body: unknown, deliveryCount = 1) {
  const settled: string[] = [];
  const d: Delivery = {
    body,
    deliveryCount,
    complete: async () => void settled.push('complete'),
    abandon: async () => void settled.push('abandon'),
    deadLetter: async (reason) => void settled.push(`deadLetter: ${reason}`),
  };
  return { d, settled };
}

const message = (workspaceId = W1): Envelope =>
  newEnvelope(AssessmentRequested, { workspaceId, payload: { applicationId: uuidv7() }, occurredAt: NOW });

const deadLetterCount = async (queue: string) => {
  const { resourceMetrics } = (await reader.collect()) as { resourceMetrics: ResourceMetrics };
  const metric = resourceMetrics.scopeMetrics
    .flatMap((s) => s.metrics)
    .find((m) => m.descriptor.name === 'credalent.worker.dead_lettered');
  return (
    metric?.dataPoints.filter((p) => p.attributes['queue'] === queue).reduce((n, p) => n + Number(p.value), 0) ?? 0
  );
};

beforeAll(async () => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] }));
  // The counter is created when the module loads, so the meter provider comes first (as initTelemetry in the worker).
  metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
  ({ createConsumer } = await import('@credalent/db/consumer'));

  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  await admin.$client.unsafe(`
    create schema worker_test;
    grant usage on schema worker_test to aivera_app;
    create table worker_test.inbox (consumer text not null, message_id uuid not null, workspace_id uuid not null,
      handled_at timestamptz not null, primary key (consumer, message_id));
    alter table worker_test.inbox enable row level security;
    alter table worker_test.inbox force row level security;
    create policy inbox_tenant_isolation on worker_test.inbox
      using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
      with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
    grant select, insert on worker_test.inbox to aivera_app;
  `);
  app = createDb(urlFor('aivera_app'), { max: 2 });
});

beforeEach(() => {
  runs = [];
  failuresLeft = 0;
  spans.reset();
});

afterAll(async () => {
  await Promise.all([app, admin].map((db) => db?.$client.end()));
  await container?.stop();
  trace.disable();
  propagation.disable();
  context.disable();
  metrics.disable();
});

describe('Scenario: A message is handled once even if delivered twice', () => {
  // SAFETY: mutation check: inbox insert without onConflictDoNothing -> this test failed (second delivery abandoned)
  it('runs the assessment once and completes the second delivery without work', async () => {
    const m = message();
    const first = delivery(m);
    const second = delivery(m);
    await consumer().handle(first.d);
    await consumer().handle(second.d);

    expect(runs).toEqual([(m.payload as { applicationId: string }).applicationId]);
    expect(first.settled).toEqual(['complete']);
    expect(second.settled).toEqual(['complete']);
    const rows = await admin.execute(
      sql`select consumer, workspace_id from worker_test.inbox where message_id = ${m.id}`,
    );
    expect([...rows]).toEqual([{ consumer: 'assessment.run', workspace_id: W1 }]);
  });

  // SAFETY: mutation check: policy on worker_test.inbox changed to using (true) -> this test failed (W1 saw the W2 row)
  it('writes the inbox row in the envelope workspace only (row-level security)', async () => {
    const m = message(W2);
    await consumer().handle(delivery(m).d);
    const seen = await app.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.workspace_id', ${W1}, true)`);
      return tx.execute(sql`select 1 from worker_test.inbox where message_id = ${m.id}`);
    });
    expect(seen).toHaveLength(0);
  });
});

// AIV-P0-010 "Worker jobs carry their workspace", moved here with the consumer wrapper.
describe('Scenario: Worker jobs carry their workspace', () => {
  it('runs the handler with app.workspace_id set to the envelope workspace', async () => {
    const settings: string[] = [];
    const scoped: Handler<unknown> = {
      ...handler,
      consumer: 'workspace.probe',
      async handle(tx) {
        const [row] = await tx.execute<{ id: string }>(sql`select current_setting('app.workspace_id') as id`);
        settings.push(row?.id ?? '');
      },
    };
    const c = createConsumer({ db: app, queue: 'assessment', handlers: [scoped], now: () => NOW });
    await c.handle(delivery(message(W2)).d);
    expect(settings).toEqual([W2]);
  });
});

describe('Scenario: Transient failures are retried', () => {
  // SAFETY: mutation check: inbox row inserted in its own transaction before the handler -> this test failed (attempt 2 skipped as a duplicate)
  it('abandons the first two attempts with back-off and succeeds on the third', async () => {
    failuresLeft = 2;
    const m = message();
    const settled: string[] = [];
    const started = Date.now();
    for (const count of [1, 2, 3]) {
      const attempt = delivery(m, count);
      await consumer().handle(attempt.d);
      settled.push(...attempt.settled);
    }
    expect(settled).toEqual(['abandon', 'abandon', 'complete']);
    expect(runs).toHaveLength(1);
    expect(Date.now() - started).toBeGreaterThanOrEqual(3000); // 1 s then 2 s back-off
  });

  it('dead-letters after the tenth delivery fails', async () => {
    failuresLeft = 1;
    const last = delivery(message(), 10);
    await consumer().handle(last.d);
    expect(last.settled).toEqual(['deadLetter: max deliveries']);
  });
});

describe('Scenario: Poison messages are dead-lettered', () => {
  // SAFETY: mutation check: payload not parsed with the event schema -> this test failed (handler ran on a bad payload)
  it('dead-letters an invalid payload on the first delivery and counts it for the queue', async () => {
    const before = await deadLetterCount('assessment');
    const poison = delivery({ ...message(), payload: { applicationId: 'not-a-uuid' } });
    await consumer().handle(poison.d);

    expect(poison.settled).toEqual(['deadLetter: invalid payload']);
    expect(runs).toEqual([]);
    expect(await deadLetterCount('assessment')).toBe(before + 1);
  });

  // SAFETY: mutation check: envelopeSchema.workspaceId made z.string().optional() -> this test failed (handler ran / withWorkspace threw)
  it('dead-letters an envelope without a valid workspace id, and an unknown event type', async () => {
    const { workspaceId: _omitted, ...withoutWorkspace } = message();
    const missing = delivery(withoutWorkspace);
    const noWorkspace = delivery({ ...message(), workspaceId: 'not-a-uuid' });
    const unknown = delivery({ ...message(), type: 'Unknown.v1' });
    await consumer().handle(missing.d);
    await consumer().handle(noWorkspace.d);
    await consumer().handle(unknown.d);
    expect(runs).toEqual([]);
    expect(missing.settled).toEqual(['deadLetter: invalid payload']);
    expect(noWorkspace.settled).toEqual(['deadLetter: invalid payload']);
    expect(unknown.settled).toEqual(['deadLetter: unknown event type']);
  });
});

describe('Scenario: Shutdown does not lose work', () => {
  it('lets the message in flight complete before drain resolves', async () => {
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    const stop = new AbortController();
    const c = createConsumer({
      db: app,
      queue: 'assessment',
      handlers: [{ ...handler, handle: () => gate } as Handler<unknown>],
      now: () => NOW,
      signal: stop.signal,
    });
    const inFlight = delivery(message());
    void c.handle(inFlight.d);
    stop.abort();
    let drained = false;
    const draining = c.drain().then(() => (drained = true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(drained).toBe(false);
    release();
    await draining;
    expect(inFlight.settled).toEqual(['complete']);
  });

  it('abandons a failed message for redelivery at once instead of waiting out its back-off', async () => {
    failuresLeft = 1;
    const stop = new AbortController();
    const c = consumer(stop.signal);
    const failing = delivery(message());
    const started = Date.now();
    void c.handle(failing.d);
    stop.abort();
    await c.drain();
    expect(failing.settled).toEqual(['abandon']);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('One trace from server action to worker', () => {
  it('starts the handler span with the envelope correlation id as parent', async () => {
    const { m, action } = trace.getTracer('test').startActiveSpan('action requestAssessment', (span) => {
      const result = { m: message(), action: span.spanContext() };
      span.end();
      return result;
    });
    await consumer().handle(delivery(m).d);
    const handled = spans.getFinishedSpans().find((s) => s.name === 'worker.handle AssessmentRequested.v1');
    expect(handled?.spanContext().traceId).toBe(action.traceId);
    expect(handled?.parentSpanContext?.spanId).toBe(action.spanId);
  });
});

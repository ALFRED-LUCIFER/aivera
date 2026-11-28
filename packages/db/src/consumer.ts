import { setTimeout as sleep } from 'node:timers/promises';
import { log, meter } from '@credalent/observability';
import { context, propagation, ROOT_CONTEXT, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Db, Tx } from './client.ts';
import { envelopeSchema, type Envelope, type EventDefinition, type InboxTable } from './outbox.ts';
import { backoffMs } from './relay.ts';
import { withWorkspace } from './withWorkspace.ts';

/** One received message and how to settle it; the worker adapts a Service Bus message to this (apps/backend/worker). */
export type Delivery = {
  body: unknown;
  /** 1 on the first delivery. */
  deliveryCount: number;
  complete(): Promise<void>;
  abandon(): Promise<void>;
  deadLetter(reason: string): Promise<void>;
};

/** A module's handler for one event type, exported from its infrastructure and registered by the worker. */
export type Handler<P> = {
  event: EventDefinition<P>;
  /** The consuming module's `<m>.inbox` (`inboxTable`). */
  inbox: InboxTable;
  /** Unique per handler; with the message id, the inbox key. */
  consumer: string;
  /**
   * Runs in the envelope's workspace transaction (ADR-005); throw to retry. `delivery.last` is true on the delivery that
   * dead-letters on a throw, so a handler can record a visible failure only then (AIV-P1-134).
   */
  handle(tx: Tx, payload: P, envelope: Envelope, delivery?: { last: boolean }): Promise<void>;
};

/** Service Bus scheduled enqueue (AIV-P0-015); the caller stores the sequence number to cancel it. */
export type Scheduler = {
  schedule(queue: string, envelope: Envelope, at: Date): Promise<string>;
  cancel(queue: string, sequenceNumber: string): Promise<void>;
};

export const MAX_DELIVERIES = 10;

/** A handler's answer a redelivery cannot change (an uncited or malformed AI output): dead-lettered on the first delivery. */
export class PermanentFailure extends Error {
  override name = 'PermanentFailure';
  readonly reason: string;
  constructor(reason: string) {
    super(`permanent failure: ${reason}`);
    this.reason = reason;
  }
}

type Outcome = 'handled' | 'failed' | { invalid: string };
type Settlement =
  { action: 'complete' } | { action: 'abandon'; delayMs: number } | { action: 'deadLetter'; reason: string };

/** The retry and dead-letter decision table (AIV-P0-015). The back-off stays under the queue's 1-minute lock. */
export function decide(outcome: Outcome, deliveryCount: number): Settlement {
  if (outcome === 'handled') return { action: 'complete' };
  if (outcome !== 'failed') return { action: 'deadLetter', reason: outcome.invalid };
  if (deliveryCount >= MAX_DELIVERIES) return { action: 'deadLetter', reason: 'max deliveries' };
  return { action: 'abandon', delayMs: Math.min(backoffMs(deliveryCount), 30_000) };
}

const deadLettered = meter.createCounter('credalent.worker.dead_lettered', {
  description: 'Messages the worker dead-lettered, per queue',
});

/**
 * The worker's consumer for one queue: parses the envelope, runs the handler for its type once per message id (the
 * inbox row is written in the handler's workspace transaction, so a duplicate delivery is completed without work),
 * and settles by `decide`. The handler span's parent is the envelope's `correlationId`. Once `signal` aborts, a
 * message waiting out its back-off is abandoned at once; `drain` resolves when every message in flight is settled.
 */
export function createConsumer(opts: {
  db: Db;
  queue: string;
  handlers: Handler<unknown>[];
  now(): Date;
  signal?: AbortSignal | undefined;
}) {
  const { db, queue, now, signal } = opts;
  const handlers = new Map(opts.handlers.map((h) => [h.event.type, h]));
  const tracer = trace.getTracer('credalent');
  const inFlight = new Set<Promise<void>>();

  async function run(delivery: Delivery): Promise<Outcome> {
    const envelope = envelopeSchema.safeParse(delivery.body);
    if (!envelope.success) return { invalid: 'invalid payload' };
    const handler = handlers.get(envelope.data.type);
    if (!handler) return { invalid: 'unknown event type' };
    const payload = handler.event.payload.safeParse(envelope.data.payload);
    if (!payload.success) return { invalid: 'invalid payload' };
    const message: Envelope = { ...envelope.data, payload: payload.data };

    const parent = propagation.extract(ROOT_CONTEXT, { traceparent: message.correlationId ?? undefined });
    return context.with(parent, () =>
      tracer.startActiveSpan(`worker.handle ${message.type}`, async (span) => {
        // Ids only: telemetry redacts every key not on its allowlist (packages/observability/src/redact.ts).
        span.setAttributes({ 'outbox.event_id': message.id, 'workspace.id': message.workspaceId });
        try {
          await withWorkspace(db, message.workspaceId, async (tx) => {
            const [first] = await tx
              .insert(handler.inbox)
              .values({
                consumer: handler.consumer,
                messageId: message.id,
                workspaceId: message.workspaceId,
                handledAt: now(),
              })
              .onConflictDoNothing()
              .returning({ messageId: handler.inbox.messageId });
            if (!first) return log.info({ 'outbox.event_id': message.id }, 'duplicate delivery skipped');
            await handler.handle(tx, payload.data, message, { last: delivery.deliveryCount >= MAX_DELIVERIES });
          });
          return 'handled';
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          if (error instanceof PermanentFailure) {
            log.warn({ 'error.type': error.reason, 'outbox.event_id': message.id }, 'message handler rejected');
            return { invalid: error.reason };
          }
          log.warn({ err: error, 'outbox.event_id': message.id }, 'message handler failed');
          return 'failed';
        } finally {
          span.end();
        }
      }),
    );
  }

  async function settle(delivery: Delivery): Promise<void> {
    const settlement = decide(await run(delivery), delivery.deliveryCount);
    if (settlement.action === 'complete') return delivery.complete();
    if (settlement.action === 'deadLetter') {
      await delivery.deadLetter(settlement.reason);
      deadLettered.add(1, { queue });
      return;
    }
    await sleep(settlement.delayMs, undefined, { signal }).catch(() => undefined);
    await delivery.abandon();
  }

  return {
    handle(delivery: Delivery): Promise<void> {
      const settled = settle(delivery).finally(() => inFlight.delete(settled));
      inFlight.add(settled);
      return settled;
    },
    /** Shutdown: resolves once every message in flight is completed, abandoned or dead-lettered. */
    drain: async () => void (await Promise.allSettled(inFlight)),
  };
}

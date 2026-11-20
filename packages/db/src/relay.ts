import { log, meter } from '@aivera/observability';
import { context, propagation, ROOT_CONTEXT, SpanStatusCode, trace } from '@opentelemetry/api';
import { and, asc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { pgSchema } from 'drizzle-orm/pg-core';
import type { Db } from './client.ts';
import { outboxTable, type Envelope } from './outbox.ts';

export type RelayPorts = {
  /** Signed in as aivera_relay (RELAY_ROLE): it reads every workspace's outbox rows and nothing else. */
  db: Db;
  /** The module schemas that have an outbox table. */
  schemas: string[];
  /** The Service Bus queue for an event type; undefined leaves the event unsent and retried, so a mapping can follow. */
  queueFor(type: string): string | undefined;
  /** Sends with `messageId = envelope.id`; throws when it was not accepted. */
  send(queue: string, envelope: Envelope): Promise<void>;
  /** The injected clock (AGENTS.md 3.9). */
  now(): Date;
  batchSize?: number;
  /** Shutdown: no new schema is claimed once it is aborted. */
  signal?: AbortSignal;
};

/** Delay before attempt `attempts + 1`: 1 s, 2 s, 4 s… capped at 5 minutes. */
export const backoffMs = (attempts: number) => Math.min(1000 * 2 ** (attempts - 1), 300_000);

const lag = meter.createHistogram('aivera.outbox.lag', {
  unit: 'ms',
  description: 'Time from an event being written to the outbox to Service Bus accepting it',
});

/**
 * One relay pass over every outbox: claims due unsent rows with FOR UPDATE SKIP LOCKED, so replicas never claim the
 * same row, sends each, and marks it sent or schedules a retry with back-off, in the claiming transaction. A crash
 * after a send and before the commit sends again with the same message id (Service Bus duplicate detection or the
 * consumer's inbox, AIV-P0-015, drops it).
 * shortcut: no cap on attempts and no dead letter for an event that never sends (an unmapped type), and lag is recorded
 * only on send, so an outage shows when it ends; add an attempts cap and an oldest-unsent gauge with AIV-P0-015 (#47).
 */
export function createRelay({ db, schemas, queueFor, send, now, batchSize = 50, signal }: RelayPorts) {
  const outboxes = schemas.map((schema) => ({ schema, table: outboxTable(pgSchema(schema)) }));
  const tracer = trace.getTracer('aivera');

  return async function relayOnce(): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    for (const { schema, table } of outboxes) {
      if (signal?.aborted) break;
      await db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(table)
          .where(and(isNull(table.sentAt), lte(table.nextAttemptAt, now())))
          .orderBy(asc(table.nextAttemptAt))
          .limit(batchSize)
          .for('update', { skipLocked: true });
        for (const [i, row] of rows.entries()) {
          const envelope: Envelope = {
            id: row.id,
            type: row.type,
            workspaceId: row.workspaceId,
            occurredAt: row.occurredAt.toISOString(),
            payload: row.payload,
            correlationId: row.correlationId,
          };
          const queue = queueFor(row.type);
          const parent = propagation.extract(ROOT_CONTEXT, { traceparent: row.correlationId ?? undefined });
          const ok = await context.with(parent, () =>
            tracer.startActiveSpan(`outbox.relay ${row.type}`, async (span) => {
              // Ids only: telemetry redacts every key not on its allowlist (packages/observability/src/redact.ts).
              span.setAttributes({ 'outbox.event_id': row.id, 'workspace.id': row.workspaceId });
              try {
                if (!queue) throw new Error(`No queue mapped for event type ${row.type}`);
                await send(queue, envelope);
                return true;
              } catch (error) {
                span.setStatus({ code: SpanStatusCode.ERROR });
                log.warn({ err: error, 'outbox.event_id': row.id }, 'outbox send failed');
                return false;
              } finally {
                span.end();
              }
            }),
          );
          const at = now();
          if (ok) {
            sent++;
            await tx.update(table).set({ sentAt: at }).where(eq(table.id, row.id));
            lag.record(at.getTime() - row.occurredAt.getTime(), { 'outbox.schema': schema });
            continue;
          }
          failed++;
          const attempts = row.attempts + 1;
          const retryAt = new Date(at.getTime() + backoffMs(attempts));
          await tx.update(table).set({ attempts, nextAttemptAt: retryAt }).where(eq(table.id, row.id));
          // Service Bus refused a send: stop here, so an outage costs one timeout per pass and the transaction stays
          // short; the rest of the batch waits as long, unattempted. An unmapped type fails alone and the pass goes on.
          if (queue) {
            const rest = rows.slice(i + 1).map((r) => r.id);
            if (rest.length > 0) await tx.update(table).set({ nextAttemptAt: retryAt }).where(inArray(table.id, rest));
            break;
          }
        }
      });
    }
    return { sent, failed };
  };
}

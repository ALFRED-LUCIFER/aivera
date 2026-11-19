import { context, propagation } from '@opentelemetry/api';
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgPolicy,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  type PgSchema,
} from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { Tx } from './client.ts';
import { tenantPolicy } from './tenantPolicy.ts';
import { uuidv7 } from './uuidv7.ts';

/** What travels to Service Bus as the message body; `id` is also the message id (AIV-P0-014). */
export type Envelope = {
  id: string;
  type: string;
  workspaceId: string;
  occurredAt: string;
  /** Opaque ids only, already validated against the publishing module's event schema. */
  payload: unknown;
  /** The W3C `traceparent` of the span active at enqueue, or null with tracing off (docs/02-architecture/modules.md). */
  correlationId: string | null;
};

/** The envelope as a consumer receives it: parsed before any handler runs (AGENTS.md 3.7). */
export const envelopeSchema = z.strictObject({
  id: z.uuid(),
  type: z.string().min(1),
  workspaceId: z.uuid(),
  occurredAt: z.iso.datetime(),
  payload: z.unknown(),
  correlationId: z.string().nullable(),
});

/**
 * A versioned event in a module's contracts. Use `z.strictObject` of opaque ids, so a field the schema does not name
 * (an email, a name) is refused rather than stripped (AGENTS.md 1.2, 3.1).
 */
export type EventDefinition<P> = { type: string; payload: z.ZodType<P> };

/** The database role the outbox relay signs in as (packages/db/sql/roles.sql, infra/sql/bootstrap-roles.sql). */
const RELAY_ROLE = 'aivera_relay';

const tz = { withTimezone: true } as const;

/**
 * The module's `<schema>.outbox` table. Export it from the module's `schema.ts` so Drizzle Kit generates it, then add
 * a custom migration (`drizzle-kit generate --custom`) with exactly this, for `<m>` the module's schema:
 *
 *   ALTER TABLE "<m>"."outbox" FORCE ROW LEVEL SECURITY;
 *   REVOKE UPDATE, DELETE, TRUNCATE ON "<m>"."outbox" FROM aivera_app;
 *   GRANT USAGE ON SCHEMA "<m>" TO aivera_relay;
 *   GRANT SELECT, UPDATE (attempts, next_attempt_at, sent_at) ON "<m>"."outbox" TO aivera_relay;
 *
 * The app writes rows of its own workspace only (tenant policy). The relay reads every workspace's rows through its
 * own policies, and may change only the delivery columns; it has no grant on any other table (ADR-005 point 4).
 */
export function outboxTable(schema: PgSchema) {
  return schema
    .table(
      'outbox',
      {
        id: uuid().primaryKey(),
        workspaceId: uuid('workspace_id').notNull(),
        type: text().notNull(),
        payload: jsonb().notNull(),
        correlationId: text('correlation_id'),
        dedupeKey: text('dedupe_key').notNull(),
        occurredAt: timestamp('occurred_at', tz).notNull(),
        attempts: integer().notNull().default(0),
        nextAttemptAt: timestamp('next_attempt_at', tz).notNull(),
        sentAt: timestamp('sent_at', tz),
      },
      (t) => [
        // A retried request enqueues the same event once.
        unique('outbox_workspace_dedupe_key').on(t.workspaceId, t.dedupeKey),
        index('outbox_unsent_idx')
          .on(t.nextAttemptAt)
          .where(sql`${t.sentAt} is null`),
        tenantPolicy('outbox_tenant_isolation', t.workspaceId),
        pgPolicy('outbox_relay_read', { for: 'select', to: RELAY_ROLE, using: sql`true` }),
        pgPolicy('outbox_relay_mark', { for: 'update', to: RELAY_ROLE, using: sql`true`, withCheck: sql`true` }),
      ],
    )
    .enableRLS();
}

export type OutboxTable = ReturnType<typeof outboxTable>;

/**
 * The consuming module's `<schema>.inbox` (AIV-P0-015): one row per handled message and consumer, written in the
 * handler's transaction, so a redelivered message is skipped. Export it from the module's `schema.ts`, generate the
 * migration, and add a custom migration with `ALTER TABLE "<m>"."inbox" FORCE ROW LEVEL SECURITY;`.
 * shortcut: rows are kept forever; prune those older than the queue's 14-day TTL once the table grows (AIV-P5-E03, #34)
 */
export function inboxTable(schema: PgSchema) {
  return schema
    .table(
      'inbox',
      {
        consumer: text().notNull(),
        messageId: uuid('message_id').notNull(),
        workspaceId: uuid('workspace_id').notNull(),
        handledAt: timestamp('handled_at', tz).notNull(),
      },
      (t) => [
        primaryKey({ columns: [t.consumer, t.messageId] }),
        tenantPolicy('inbox_tenant_isolation', t.workspaceId),
      ],
    )
    .enableRLS();
}

export type InboxTable = ReturnType<typeof inboxTable>;

/** A new envelope for `event`, its payload validated and the active trace as its correlation id. */
export function newEnvelope<P>(
  event: EventDefinition<P>,
  input: { workspaceId: string; payload: P; occurredAt: Date },
): Envelope {
  const carrier: { traceparent?: string } = {};
  propagation.inject(context.active(), carrier);
  return {
    id: uuidv7(),
    type: event.type,
    workspaceId: input.workspaceId,
    occurredAt: input.occurredAt.toISOString(),
    payload: event.payload.parse(input.payload),
    correlationId: carrier.traceparent ?? null,
  };
}

/**
 * Writes the event to the module's outbox in the caller's transaction, so it commits or rolls back with the change.
 * Throws before writing when the payload fails the event's schema. The same `dedupeKey` in a workspace is written once.
 */
export async function enqueue<P>(
  tx: Tx,
  outbox: OutboxTable,
  event: EventDefinition<P>,
  input: { workspaceId: string; payload: P; dedupeKey: string; occurredAt: Date },
): Promise<void> {
  const { id, type, payload, correlationId } = newEnvelope(event, input);
  await tx
    .insert(outbox)
    .values({
      id,
      workspaceId: input.workspaceId,
      type,
      payload,
      correlationId,
      dedupeKey: input.dedupeKey,
      occurredAt: input.occurredAt,
      nextAttemptAt: input.occurredAt,
    })
    .onConflictDoNothing({ target: [outbox.workspaceId, outbox.dedupeKey] });
}

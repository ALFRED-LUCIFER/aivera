import { inboxTable, outboxTable } from '@aivera/db/outbox';
import { tenantPolicy } from '@aivera/db/tenant-policy';
import { sql } from 'drizzle-orm';
import { check, pgPolicy, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { MESSAGE_STATUSES } from '../domain/email.ts';

export const notifications = pgSchema('notifications');

const tz = { withTimezone: true } as const;

// The delivery-report webhook knows only ACS's message id, not the workspace. These two policies let aivera_app read
// and mark exactly the row whose provider id the transaction names (`app.provider_message_id`, set only by
// applyDeliveryReport); every other read stays behind the tenant policy (ADR-005, tests/integration/src/tenancy.test.ts).
// Accepted risk: in that one transaction any column of that row could be updated; only the status is.
const namedProviderId = sql`provider_message_id = nullif(current_setting('app.provider_message_id', true), '')`;

/**
 * The send log (AIV-P0-017). `sealed` is the recipient, reply-to, subject and rendered bodies, encrypted at column
 * level (AES-256-GCM); only `recipient_hash` (an HMAC) may be logged. Never log a row.
 */
export const message = notifications
  .table(
    'message',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      template: text().notNull(),
      recipientHash: text('recipient_hash').notNull(),
      sealed: text().notNull(),
      status: text({ enum: MESSAGE_STATUSES }).notNull(),
      providerMessageId: text('provider_message_id'),
      /** The human-confirmed action that caused the send (AGENTS.md 1.5): an opaque id from the calling module. */
      causedBy: uuid('caused_by').notNull(),
      createdAt: timestamp('created_at', tz).notNull(),
      sentAt: timestamp('sent_at', tz),
    },
    (t) => [
      check('message_status_check', sql`${t.status} in ('queued', 'sent', 'failed', 'bounced')`),
      // One ACS message id names one row.
      uniqueIndex('message_provider_message_id_key').on(t.providerMessageId),
      tenantPolicy('message_tenant_isolation', t.workspaceId),
      pgPolicy('message_delivery_report_read', { for: 'select', to: 'aivera_app', using: namedProviderId }),
      pgPolicy('message_delivery_report_mark', {
        for: 'update',
        to: 'aivera_app',
        using: namedProviderId,
        withCheck: namedProviderId,
      }),
    ],
  )
  .enableRLS();

export const outbox = outboxTable(notifications);
export const inbox = inboxTable(notifications);

// Builds the notifications module for an app (ADR-002: only apps and tests import this).
import type { Db } from '@aivera/db';
import type { Handler } from '@aivera/db/consumer';
import { enqueue } from '@aivera/db/outbox';
import { uuidv7 } from '@aivera/db/uuidv7';
import { defaultLocale, defaultTimeZone } from '@aivera/i18n';
import { log } from '@aivera/observability';
import { eq } from 'drizzle-orm';
import { queueEmail, sendQueued, type MessageRow, type SealedEmail } from './application/emails.ts';
import { EmailQueuedV1, type NotificationsContract } from './contracts/index.ts';
import { createAcsSender, type AcsConfig } from './infrastructure/acs.ts';
import { applyDeliveryReport, parseEventGrid } from './infrastructure/deliveryReport.ts';
import { inbox, message, outbox } from './infrastructure/schema.ts';
import { createSealer } from './infrastructure/seal.ts';

export { ReportTooEarly } from './infrastructure/deliveryReport.ts';

/** The queue EmailQueued.v1 goes to (infra/modules/messaging.bicep). */
export const NOTIFICATIONS_QUEUE = 'notifications';

/**
 * Where emails are queued (the web app, within a confirmed action's transaction). `encryptionKey` is the Key Vault
 * secret notifications-encryption-key (base64, 32 bytes); `origin` the web app's public URL; `synthetic` adds the
 * development band. `now` is the injected clock (AGENTS.md 3.9).
 */
export function createNotifications(config: {
  encryptionKey: string;
  origin: string;
  synthetic: boolean;
  now?: () => Date;
}): NotificationsContract {
  const sealer = createSealer(config.encryptionKey);
  const now = config.now ?? (() => new Date());
  return {
    queueEmail: (ctx, input) =>
      queueEmail(
        {
          // Loaded on first use: React Email templates are JSX, which the worker (plain node) never needs.
          render: async (template, data, sender) => {
            const { renderEmail } = await import('./infrastructure/templates/render.ts');
            return renderEmail(template, data, {
              locale: defaultLocale,
              timeZone: defaultTimeZone,
              origin: config.origin,
              synthetic: config.synthetic,
              sender,
            });
          },
          seal: (value) => sealer.seal(value),
          hash: (email) => sealer.hash(email),
          insert: async (tx, row) => void (await tx.insert(message).values(row)),
          publishQueued: (tx, row) =>
            enqueue(tx, outbox, EmailQueuedV1, {
              workspaceId: row.workspaceId,
              payload: { messageId: row.id },
              dedupeKey: `email:${row.id}`,
              occurredAt: row.createdAt,
            }),
          newId: uuidv7,
          now,
        },
        ctx,
        input,
      ),
  };
}

/** The worker's handler for EmailQueued.v1 on the notifications queue: sends through ACS and records the outcome. */
export function createEmailHandler(config: {
  encryptionKey: string;
  acs: AcsConfig;
  now?: () => Date;
}): Handler<{ messageId: string }> {
  const sealer = createSealer(config.encryptionKey);
  const send = createAcsSender(config.acs);
  const now = config.now ?? (() => new Date());
  return {
    event: EmailQueuedV1,
    inbox,
    consumer: 'notifications.send',
    handle: (tx, { messageId }) =>
      sendQueued(
        {
          find: async (t, id) =>
            (await t.select().from(message).where(eq(message.id, id)))[0] as MessageRow | undefined,
          open: (sealed) => sealer.open<SealedEmail>(sealed),
          send,
          mark: async (t, id, change) => void (await t.update(message).set(change).where(eq(message.id, id))),
          // The recipient appears only as its HMAC (AGENTS.md 1.2).
          logSent: (row, status) =>
            log.info(
              { 'notification.id': row.id, 'notifications.recipient_hash': row.recipientHash },
              status === 'sent' ? 'email sent' : 'email refused by ACS',
            ),
          now,
        },
        tx,
        messageId,
      ),
  };
}

/**
 * The web app's Event Grid webhook (apps/web/src/app/api/webhooks/acs-email): answers the handshake, or applies each
 * delivery report in its own transaction. Throws ZodError on a body that is not Event Grid's, and ReportTooEarly when
 * a report names no row yet (the route answers 503, so Event Grid retries).
 */
export async function handleEventGrid(
  db: Db,
  body: unknown,
): Promise<{ validationResponse: string } | { updated: number }> {
  const parsed = parseEventGrid(body);
  if ('validationResponse' in parsed) return parsed;
  let updated = 0;
  for (const report of parsed.reports) updated += await db.transaction((tx) => applyDeliveryReport(tx, report));
  return { updated };
}

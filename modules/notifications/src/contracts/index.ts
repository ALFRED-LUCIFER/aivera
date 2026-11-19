// The only public surface of @aivera/notifications (ADR-002): the one place that sends email.
import type { Tx } from '@aivera/db';
import type { EventDefinition } from '@aivera/db/outbox';
import { z } from 'zod';
import type { QueueEmailInput } from '../application/emails.ts';
import type { TemplateName } from '../domain/email.ts';

export { EmailError } from '../domain/email.ts';
export type { EmailErrorCode, MessageStatus, Sender, TemplateData, TemplateName } from '../domain/email.ts';
export type { QueueEmailInput } from '../application/emails.ts';

/** Written with the queued row and sent to the `notifications` queue; the worker sends the email. Ids only. */
export const EmailQueuedV1 = {
  type: 'EmailQueued.v1',
  payload: z.strictObject({ messageId: z.uuid() }),
} satisfies EventDefinition<{ messageId: string }>;

export interface NotificationsContract {
  /**
   * Queues an email in the caller's workspace transaction (a module's confirmed action): validates `data` against
   * the template's schema, renders it, seals the addresses and bodies on a `notifications.message` row and writes
   * EmailQueued.v1. Replies go to `sender.email`. Throws `EmailError` (`no_cause`, `invalid_data` naming the fields,
   * `unknown_template`, `invalid_address`) before writing anything.
   */
  queueEmail<T extends TemplateName>(
    ctx: { tx: Tx; workspaceId: string },
    input: QueueEmailInput<T>,
  ): Promise<{ messageId: string }>;
}

import type { Tx } from '@credalent/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { statusForDelivery, type MessageStatus } from '../domain/email.ts';
import { message } from './schema.ts';

// ACS email delivery reports through an Event Grid webhook subscription (AIV-P0-017). The payload names the recipient:
// it is parsed for the message id and status only and never logged.

const event = z.object({ eventType: z.string(), data: z.unknown() });
const validation = z.object({ validationCode: z.string().min(1) });
const report = z.object({ messageId: z.string().min(1), status: z.string().min(1) });

export type ParsedEventGrid =
  { validationResponse: string } | { reports: { providerMessageId: string; status: MessageStatus }[] };

/** Event Grid's handshake, or the delivery reports that change a row (Delivered and Expanded change nothing). */
export function parseEventGrid(body: unknown): ParsedEventGrid {
  const events = z.array(event).min(1).parse(body);
  const handshake = events.find((e) => e.eventType === 'Microsoft.EventGrid.SubscriptionValidationEvent');
  if (handshake) return { validationResponse: validation.parse(handshake.data).validationCode };
  const reports = events
    .filter((e) => e.eventType === 'Microsoft.Communication.EmailDeliveryReportReceived')
    .map((e) => report.parse(e.data))
    .map(({ messageId, status }) => ({ providerMessageId: messageId, status: statusForDelivery(status) }))
    .filter((r): r is { providerMessageId: string; status: MessageStatus } => r.status !== undefined);
  return { reports };
}

/** Thrown when a report names no row yet: the worker's commit may still be on its way, so Event Grid should retry. */
export class ReportTooEarly extends Error {
  override name = 'ReportTooEarly';
}

/**
 * Applies one report in `tx`. The webhook has no workspace: the row is reachable only by naming its provider id
 * (schema.ts). Only `queued` and `sent` rows move, so a repeated report changes nothing. Returns the rows updated.
 */
export async function applyDeliveryReport(
  tx: Tx,
  { providerMessageId, status }: { providerMessageId: string; status: MessageStatus },
): Promise<number> {
  await tx.execute(sql`select set_config('app.provider_message_id', ${providerMessageId}, true)`);
  const updated = await tx
    .update(message)
    .set({ status })
    .where(and(eq(message.providerMessageId, providerMessageId), inArray(message.status, ['queued', 'sent'])))
    .returning({ id: message.id });
  if (updated.length > 0) return updated.length;
  const known = await tx
    .select({ id: message.id })
    .from(message)
    .where(eq(message.providerMessageId, providerMessageId));
  if (known.length === 0) throw new ReportTooEarly('No send-log row has this provider message id yet');
  return 0;
}

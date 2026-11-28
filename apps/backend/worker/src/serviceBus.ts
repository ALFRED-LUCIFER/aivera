// The Service Bus side of the worker host (AIV-P0-015): the message shape, scheduled enqueue, and the adapter from a
// received message to the consumer's Delivery. The consumer logic itself is SDK-free (@credalent/db/consumer).
import type { Delivery, Scheduler } from '@credalent/db/consumer';
import type { Envelope } from '@credalent/db';
import { envelopeSchema } from '@credalent/db';
import { log } from '@credalent/observability';
import type { ServiceBusReceivedMessage, ServiceBusReceiver, ServiceBusSender } from '@azure/service-bus';
import Long from 'long';

/** The envelope as a Service Bus message; `messageId` is the event id, which the consumer's inbox deduplicates on. */
export const toMessage = (envelope: Envelope) => ({
  messageId: envelope.id,
  body: envelope,
  contentType: 'application/json',
  subject: envelope.type,
});

/** Scheduled enqueue: not delivered before `at`; the returned sequence number cancels it. */
export function createScheduler(senderFor: (queue: string) => ServiceBusSender): Scheduler {
  return {
    async schedule(queue, envelope, at) {
      const [sequenceNumber] = await senderFor(queue).scheduleMessages(toMessage(envelopeSchema.parse(envelope)), at);
      if (!sequenceNumber) throw new Error('Service Bus returned no sequence number for the scheduled message');
      return sequenceNumber.toString();
    },
    cancel: (queue, sequenceNumber) => senderFor(queue).cancelScheduledMessages(Long.fromString(sequenceNumber)),
  };
}

/** A received message as the consumer's Delivery, settled on `receiver`. */
export const toDelivery = (receiver: ServiceBusReceiver, message: ServiceBusReceivedMessage): Delivery => ({
  body: message.body,
  // AMQP counts earlier failed deliveries, so the first delivery reads 0.
  deliveryCount: (message.deliveryCount ?? 0) + 1,
  complete: () => receiver.completeMessage(message),
  abandon: () => receiver.abandonMessage(message),
  // Both fields hold the fixed code, so nothing from the payload or an error message reaches the dead-letter metadata.
  deadLetter: (reason) =>
    receiver.deadLetterMessage(message, { deadLetterReason: reason, deadLetterErrorDescription: reason }),
});

/**
 * Marks a consumer outside `createConsumer` (no outbox envelope, so no envelope workspace transaction) as declared on
 * purpose (AGENTS.md 1.3); `reason` says how it scopes itself. The entry-point architecture test refuses an empty one.
 */
export const systemConsumer = (_reason: string, handle: (delivery: Delivery) => Promise<void>) => handle;

/** The queue of the events nothing handles yet (apps/backend/worker/src/main.ts, QUEUES). */
export const UNHANDLED_QUEUE = 'candidates';

/**
 * The consumer of `UNHANDLED_QUEUE` (AIV-P1-165): completes each event, so none stays active and unconsumed until its
 * 14-day time to live dead-letters it. The event is not lost: its row stays in its module's outbox, marked sent, for
 * the consumer a later ticket adds. A body that is not an envelope is dead-lettered.
 */
export async function acknowledgeUnhandled(delivery: Delivery): Promise<void> {
  const envelope = envelopeSchema.safeParse(delivery.body);
  if (!envelope.success) return delivery.deadLetter('invalid payload');
  log.info({ 'outbox.event_id': envelope.data.id }, 'event with no handler completed');
  await delivery.complete();
}

/** Streams `receiver`'s messages to `handle`, settling manually; close the returned subscription to stop receiving. */
export const subscribe = (receiver: ServiceBusReceiver, handle: (delivery: Delivery) => Promise<void>) =>
  receiver.subscribe(
    {
      processMessage: (message) => handle(toDelivery(receiver, message)),
      processError: async ({ error, errorSource, entityPath }) =>
        log.error({ err: error, area: errorSource, 'messaging.destination': entityPath }, 'service bus receive failed'),
    },
    { autoCompleteMessages: false, maxConcurrentCalls: 4 },
  );

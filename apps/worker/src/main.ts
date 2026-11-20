// The worker (ADR-002: composition only). Today it runs the outbox relay (AIV-P0-014); consumers, the inbox, scheduled
// messages, dead-letter handling and health probes come with the worker host (AIV-P0-015, #47).
import { setTimeout as sleep } from 'node:timers/promises';
import { initTelemetry } from '@aivera/observability/init';
import { z } from 'zod';

const env = z
  .object({
    // Signed in as aivera_relay; without a password, with the managed identity in AZURE_CLIENT_ID (packages/db).
    RELAY_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    // The fully qualified namespace, `<name>.servicebus.windows.net`; Entra sign-in only (infra/modules/messaging.bicep).
    AZURE_SERVICE_BUS_NAMESPACE: z.string().min(1),
    APPLICATIONINSIGHTS_CONNECTION_STRING: z.string().optional(),
  })
  .parse(process.env);

// Before the other imports, so their instrumentation is patched (packages/observability/src/init.ts).
initTelemetry('worker', env.APPLICATIONINSIGHTS_CONNECTION_STRING);

const { DefaultAzureCredential } = await import('@azure/identity');
const { ServiceBusClient } = await import('@azure/service-bus');
const { PersonCreatedV1 } = await import('@aivera/candidates');
const { createDb } = await import('@aivera/db');
const { createRelay } = await import('@aivera/db/relay');
const { log } = await import('@aivera/observability');

// The module schemas with an outbox table, and each event type's queue (the consuming module's). A publishing module's
// ticket adds its schema, its events and their queue (infra/modules/messaging.bicep).
const OUTBOXES = ['candidates'];
const QUEUES: Record<string, string> = { [PersonCreatedV1.type]: 'candidates' };

const stop = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => stop.abort());

const db = createDb(env.RELAY_DATABASE_URL, { max: 1 });
// One quick try per send: the relay retries with its own back-off, and a long SDK retry would hold the claimed rows.
const serviceBus = new ServiceBusClient(env.AZURE_SERVICE_BUS_NAMESPACE, new DefaultAzureCredential(), {
  retryOptions: { maxRetries: 0, timeoutInMs: 10_000 },
});
const senders = new Map<string, ReturnType<typeof serviceBus.createSender>>();
const senderFor = (queue: string) => {
  let sender = senders.get(queue);
  if (!sender) senders.set(queue, (sender = serviceBus.createSender(queue)));
  return sender;
};

const relayOnce = createRelay({
  db,
  schemas: OUTBOXES,
  queueFor: (type) => QUEUES[type],
  send: (queue, envelope) =>
    senderFor(queue).sendMessages(
      { messageId: envelope.id, body: envelope, contentType: 'application/json', subject: envelope.type },
      { abortSignal: stop.signal },
    ),
  now: () => new Date(),
  signal: stop.signal,
});

log.info('outbox relay started');
while (!stop.signal.aborted) {
  try {
    await relayOnce();
  } catch (error) {
    log.error({ err: error }, 'outbox relay pass failed');
  }
  // One pass a second keeps an event's send within the 5 seconds of AIV-P0-014.
  await sleep(1000, undefined, { signal: stop.signal }).catch(() => undefined);
}
// The pass in progress finished above, so every claimed row is marked sent or scheduled for retry before exit.
await Promise.all([...senders.values()].map((sender) => sender.close()));
await serviceBus.close();
await db.$client.end();
log.info('outbox relay stopped');

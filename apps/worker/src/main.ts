// The worker host (ADR-002: composition only): the outbox relay (AIV-P0-014) and the queue consumers (AIV-P0-015),
// with health and readiness on an internal port.
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { initTelemetry } from '@credalent/observability/init';
import { z } from 'zod';

const env = z
  .object({
    // Consumers sign in as aivera_app; without a password, with the identity in AZURE_CLIENT_ID (packages/db).
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    // The relay signs in as aivera_relay with its own identity, RELAY_CLIENT_ID (infra/modules/messaging.bicep).
    RELAY_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    AZURE_CLIENT_ID: z.string().optional(),
    RELAY_CLIENT_ID: z.string().optional(),
    // The fully qualified namespace, `<name>.servicebus.windows.net`; Entra sign-in only (infra/modules/messaging.bicep).
    AZURE_SERVICE_BUS_NAMESPACE: z.string().min(1),
    APPLICATIONINSIGHTS_CONNECTION_STRING: z.string().optional(),
    // Email (AIV-P0-017): the ACS endpoint, its verified-domain sender, and the send log's column key (Key Vault).
    ACS_ENDPOINT: z.url({ protocol: /^https$/ }),
    EMAIL_SENDER: z.email(),
    NOTIFICATIONS_ENCRYPTION_KEY: z.string().min(1),
    PORT: z.coerce.number().int().default(8080),
    // Uploads (AIV-P0-016): on and with the blob endpoint, the worker settles each upload from Defender's scan result.
    // Without either it never settles one, so uploads stay pending: fail closed (the worker never skips the scan).
    // shortcut: malware scanning off in dev (synthetic data, owner decision 20 Nov 2026); the pilot sets MALWARE_SCANNING=on
    MALWARE_SCANNING: z.enum(['on', 'off']).default('on'),
    AZURE_STORAGE_BLOB_URL: z.url({ protocol: /^https$/ }).optional(),
  })
  .parse(process.env);

// Before the other imports, so their instrumentation is patched (packages/observability/src/init.ts).
initTelemetry('worker', env.APPLICATIONINSIGHTS_CONNECTION_STRING);

const { DefaultAzureCredential } = await import('@azure/identity');
const { ServiceBusClient } = await import('@azure/service-bus');
const { PersonCreatedV1 } = await import('@credalent/candidates');
const { EvidenceRecordedV1 } = await import('@credalent/evidence');
const { JobPublishedV1, JobUnpublishedV1, RubricApprovedV1 } = await import('@credalent/jobs');
const { EmailQueuedV1 } = await import('@credalent/notifications');
const { createEmailHandler, NOTIFICATIONS_QUEUE } = await import('@credalent/notifications/composition');
const { createBlobStore, createFiles, SCAN_RESULTS_QUEUE } = await import('@credalent/files/composition');
const { createDb, isReachable } = await import('@credalent/db');
const { createConsumer } = await import('@credalent/db/consumer');
const { createRelay } = await import('@credalent/db/relay');
const { log } = await import('@credalent/observability');
const { subscribe, toMessage } = await import('./serviceBus.ts');

// The module schemas with an outbox table, and each event type's queue (the consuming module's). A publishing module's
// ticket adds its schema, its events and their queue (infra/modules/messaging.bicep).
// shortcut: `files` (FileClean.v1, FileRejected.v1) is left out until something consumes them (CV parsing, AIV-P1-025):
// its events wait unsent in files.outbox rather than retry with no queue; that ticket adds the schema and the mapping.
const OUTBOXES = ['candidates', 'jobs', 'evidence', 'notifications'];
const QUEUES: Record<string, string> = {
  [PersonCreatedV1.type]: 'candidates',
  // shortcut: nothing consumes `assessment` until AIV-P1-031, so RubricApproved.v1 and EvidenceRecorded.v1 dead-letter
  // after their 14-day TTL like PersonCreated.v1 above; the assessment consumer replaces this note.
  [RubricApprovedV1.type]: 'assessment',
  [EvidenceRecordedV1.type]: 'assessment',
  // shortcut: nothing consumes these yet (applying from the candidate site is AIV-P3-008), so they dead-letter after the
  // 14-day TTL like PersonCreated.v1 above; that ticket's consumer replaces this note.
  [JobPublishedV1.type]: 'candidates',
  [JobUnpublishedV1.type]: 'candidates',
  [EmailQueuedV1.type]: NOTIFICATIONS_QUEUE,
};

const stop = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => stop.abort());
const now = () => new Date();

const appDb = createDb(env.DATABASE_URL);
// Two connections: the readiness probe must not wait behind a relay pass held up by a Service Bus timeout.
const relayDb = createDb(env.RELAY_DATABASE_URL, {
  max: 2,
  ...(env.RELAY_CLIENT_ID && { clientId: env.RELAY_CLIENT_ID }),
});
// Two identities: Data Sender for the relay's, Data Receiver for the app's (infra/modules/messaging.bicep).
const credential = (clientId: string | undefined) =>
  new DefaultAzureCredential(clientId ? { managedIdentityClientId: clientId } : {});
// One quick try per send: the relay retries with its own back-off, and a long SDK retry would hold the claimed rows.
const relayBus = new ServiceBusClient(env.AZURE_SERVICE_BUS_NAMESPACE, credential(env.RELAY_CLIENT_ID), {
  retryOptions: { maxRetries: 0, timeoutInMs: 10_000 },
});
const appCredential = credential(env.AZURE_CLIENT_ID);
const appBus = new ServiceBusClient(env.AZURE_SERVICE_BUS_NAMESPACE, appCredential);

// Each queue's handlers, exported by the consuming module's infrastructure. A consuming module's ticket adds its queue.
// shortcut: nothing consumes `candidates` yet, so PersonCreated.v1 dead-letters after its 14-day TTL and raises the dead-letter alert; add its consumer or drop the mapping with the first candidates handler (AIV-P1-018)
const CONSUMERS: Record<string, Parameters<typeof createConsumer>[0]['handlers']> = {
  [NOTIFICATIONS_QUEUE]: [
    createEmailHandler({
      encryptionKey: env.NOTIFICATIONS_ENCRYPTION_KEY,
      now,
      acs: {
        endpoint: env.ACS_ENDPOINT,
        senderAddress: env.EMAIL_SENDER,
        // The app identity holds the email sender role on the ACS resource (infra/modules/communication.bicep).
        token: async () => {
          const token = await appCredential.getToken('https://communication.azure.com/.default');
          if (!token) throw new Error('No Entra token for Azure Communication Services');
          return token.token;
        },
      },
    }),
  ],
};
const senders = new Map<string, ReturnType<typeof relayBus.createSender>>();
const senderFor = (queue: string) => {
  let sender = senders.get(queue);
  if (!sender) senders.set(queue, (sender = relayBus.createSender(queue)));
  return sender;
};

// Defender's scan results, which Event Grid puts on their own queue (infra/modules/storage.bicep): Event Grid events,
// not outbox envelopes, so not through createConsumer. A settled file ignores a redelivery, so no inbox is needed.
// Invalid bodies are dead-lettered at once; any other failure is abandoned for Service Bus to redeliver (10 times).
const scanResults =
  env.MALWARE_SCANNING === 'on' && env.AZURE_STORAGE_BLOB_URL
    ? (() => {
        const files = createFiles({
          db: appDb,
          // Scan results carry no member: every request-context call is refused here.
          workspaces: { authorize: () => Promise.reject(new Error('no request context in the worker')) },
          blobs: createBlobStore({ url: env.AZURE_STORAGE_BLOB_URL, clientId: env.AZURE_CLIENT_ID }),
          malwareScanning: true,
          now,
        });
        const receiver = appBus.createReceiver(SCAN_RESULTS_QUEUE);
        const subscription = subscribe(receiver, async (delivery) => {
          try {
            await files.handleScanResult(delivery.body);
            await delivery.complete();
          } catch (error) {
            if (error instanceof z.ZodError) return delivery.deadLetter('invalid payload');
            log.warn({ err: error, area: 'files' }, 'scan result failed');
            await delivery.abandon();
          }
        });
        return { receiver, subscription };
      })()
    : null;

const consumers = Object.entries(CONSUMERS).map(([queue, handlers]) => {
  const consumer = createConsumer({ db: appDb, queue, handlers, now, signal: stop.signal });
  const receiver = appBus.createReceiver(queue);
  return { consumer, receiver, subscription: subscribe(receiver, consumer.handle) };
});

// Internal port only (no ingress): Container Apps probes.
const health = createServer((request, response) => {
  if (request.url === '/health')
    return response.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
  if (request.url !== '/ready') return response.writeHead(404).end();
  void Promise.all([isReachable(appDb, 2000), isReachable(relayDb, 2000)]).then(([app, relay]) => {
    const failing = [...(app ? [] : ['postgres']), ...(relay ? [] : ['postgres-relay'])];
    response
      .writeHead(failing.length ? 503 : 200, { 'content-type': 'application/json' })
      .end(JSON.stringify(failing.length ? { status: 'unavailable', failing } : { status: 'ok' }));
  });
}).listen(env.PORT);

const relayOnce = createRelay({
  db: relayDb,
  schemas: OUTBOXES,
  queueFor: (type) => QUEUES[type],
  send: (queue, envelope) => senderFor(queue).sendMessages(toMessage(envelope), { abortSignal: stop.signal }),
  now,
  signal: stop.signal,
});

log.info('worker started');
while (!stop.signal.aborted) {
  try {
    await relayOnce();
  } catch (error) {
    log.error({ err: error }, 'outbox relay pass failed');
  }
  // One pass a second keeps an event's send within the 5 seconds of AIV-P0-014.
  await sleep(1000, undefined, { signal: stop.signal }).catch(() => undefined);
}

// Shutdown: stop receiving, let messages in flight complete (or abandon those waiting out a back-off), then close.
// A message whose lock lapses meanwhile is redelivered by Service Bus, never lost.
await Promise.all(
  [...consumers, ...(scanResults ? [scanResults] : [])].map(({ subscription }) => subscription.close()),
);
await Promise.all(consumers.map(({ consumer }) => consumer.drain()));
await Promise.all([...consumers, ...(scanResults ? [scanResults] : [])].map(({ receiver }) => receiver.close()));
// The relay pass in progress finished above, so every claimed row is marked sent or scheduled for retry.
await Promise.all([...senders.values()].map((sender) => sender.close()));
await Promise.all([relayBus.close(), appBus.close()]);
await Promise.all([appDb.$client.end(), relayDb.$client.end()]);
health.close();
log.info('worker stopped');

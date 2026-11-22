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
    // GitHub evidence (AIV-P1-026): the GitHub App's id, PEM private key (Key Vault) and installation id; all or none.
    GITHUB_APP_ID: z.string().min(1).optional(),
    GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
    GITHUB_APP_INSTALLATION_ID: z.string().min(1).optional(),
    PORT: z.coerce.number().int().default(8080),
    // Uploads (AIV-P0-016): on and with the blob endpoint, the worker settles each upload from Defender's scan result.
    // Without either it never settles one, so uploads stay pending: fail closed (the worker never skips the scan).
    // shortcut: malware scanning off in dev (synthetic data, owner decision 20 Nov 2026); the pilot sets MALWARE_SCANNING=on
    MALWARE_SCANNING: z.enum(['on', 'off']).default('on'),
    // The catalogue draft eval (AIV-P2-048): `on` only where the `jobs` queue exists (infra/modules/messaging.bicep sets
    // it with the queue). Off, its requests stay unmapped in jobs.outbox, where an unmapped type fails alone: mapped to a
    // missing queue, every refused send would hold back the rest of the batch, RubricApproved.v1 included.
    CATALOGUE_EVAL: z.enum(['on', 'off']).default('off'),
    AZURE_STORAGE_BLOB_URL: z.url({ protocol: /^https$/ }).optional(),
    // CV parsing and document reads (AIV-P1-025, AIV-P1-028): Document Intelligence on the AI resource, signed in with
    // AZURE_CLIENT_ID's identity. Set, with AZURE_STORAGE_BLOB_URL, the worker reads clean CVs and documents; the model
    // comes from AI_PROVIDER or AZURE_OPENAI_RESOURCE_NAME (packages/ai providerFromEnv).
    AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: z.url({ protocol: /^https$/ }).optional(),
    // Evidence mapping (AIV-P1-027): the AI Foundry resource, called with the app identity; or AI_PROVIDER=fake in
    // local and dev (packages/ai providerFromEnv). Without either, evidence is recorded but not mapped.
    AZURE_OPENAI_RESOURCE_NAME: z.string().min(1).optional(),
    AI_PROVIDER: z.enum(['fake']).optional(),
  })
  .refine(
    (e) =>
      [e.GITHUB_APP_ID, e.GITHUB_APP_PRIVATE_KEY, e.GITHUB_APP_INSTALLATION_ID].every((v) => v === undefined) ||
      [e.GITHUB_APP_ID, e.GITHUB_APP_PRIVATE_KEY, e.GITHUB_APP_INSTALLATION_ID].every((v) => v !== undefined),
    'Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_APP_INSTALLATION_ID together, or none of them',
  )
  .parse(process.env);

// Before the other imports, so their instrumentation is patched (packages/observability/src/init.ts).
initTelemetry('worker', env.APPLICATIONINSIGHTS_CONNECTION_STRING);

const { DefaultAzureCredential } = await import('@azure/identity');
const { ServiceBusClient } = await import('@azure/service-bus');
const { PersonCreatedV1 } = await import('@credalent/candidates');
const { createAiClient, providerFromEnv } = await import('@credalent/ai');
const { ASSESSMENT_QUEUE, createAssessmentHandlers } = await import('@credalent/assessment/composition');
const { createAudit } = await import('@credalent/audit/composition');
const { createContactRecorder, nameUnnamedPerson, readPersonAsSystem } =
  await import('@credalent/candidates/composition');
const {
  CvParseRequestedV1,
  DocumentReadRequestedV1,
  EvidenceMappedV1,
  EvidenceMappingRequestedV1,
  EvidenceRecordedV1,
  LinkReadRequestedV1,
  RepositoryReadRequestedV1,
  RepositoryRefreshRequestedV1,
} = await import('@credalent/evidence');
const {
  createApplicationReceivedHandler,
  createEvidenceMappingHandlers,
  createFileReadHandlers,
  createLinkReadHandler,
  createRepositoryReadHandler,
  createRepositoryRefreshHandler,
  EVIDENCE_QUEUE,
  readEvidenceForJobAsSystem,
} = await import('@credalent/evidence/composition');
const { ApplicationReceivedV1 } = await import('@credalent/intake');
const { createApplicationReads, readApplicationSourceAsSystem } = await import('@credalent/intake/composition');
const { createAiTokenBudget } = await import('@credalent/workspaces/composition');
const { CatalogueEvalRequestedV1, JobPublishedV1, JobUnpublishedV1, RubricApprovedV1 } =
  await import('@credalent/jobs');
const { CATALOGUE_EVAL_QUEUE, createApprovedRubricReads, createCatalogueEvalHandler } =
  await import('@credalent/jobs/composition');
const { evaluateCatalogue, runBudget } = await import('@credalent/ai/evals');
const { EmailQueuedV1 } = await import('@credalent/notifications');
const { createEmailHandler, NOTIFICATIONS_QUEUE } = await import('@credalent/notifications/composition');
const { FileCleanV1, FileRejectedV1 } = await import('@credalent/files');
const { createBlobStore, createCleanFileReader, createFiles, readFilePurposeAsSystem, SCAN_RESULTS_QUEUE } =
  await import('@credalent/files/composition');
const { createDb, isReachable } = await import('@credalent/db');
const { createConsumer, decide } = await import('@credalent/db/consumer');
const { createRelay } = await import('@credalent/db/relay');
const { log } = await import('@credalent/observability');
const { createScheduler, subscribe, systemConsumer, toMessage } = await import('./serviceBus.ts');

// The module schemas with an outbox table, and each event type's queue (the consuming module's). A publishing module's
// ticket adds its schema, its events and their queue (infra/modules/messaging.bicep).
// shortcut: `files` (FileClean.v1, FileRejected.v1) is left out until something consumes them (CV parsing, AIV-P1-025):
// its events wait unsent in files.outbox rather than retry with no queue; that ticket adds the schema and the mapping.
const githubApp = env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_APP_INSTALLATION_ID;
// Each evidence integration's events are mapped only when its consumer runs: an event with no handler is dead-lettered
// on arrival, while an unmapped one waits in its outbox (retried by the relay) until the owner configures it.
const fileReading = Boolean(env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT && env.AZURE_STORAGE_BLOB_URL);
// shortcut: `files` (FileClean.v1, FileRejected.v1) is relayed only with file reading, their one consumer (AIV-P1-025).
const OUTBOXES = ['candidates', 'jobs', 'intake', 'evidence', 'notifications', ...(fileReading ? ['files'] : [])];
// Evidence mapping (AIV-P1-027) consumes evidence and rubric changes when the worker has a model and the evidence queue
// has its consumer (the GitHub App, below), and its EvidenceMapped.v1 is scored on `assessment`; otherwise they go to
// `assessment` directly (AIV-P1-031), so the evidence queue never receives an event nothing handles.
const model = env.AZURE_OPENAI_RESOURCE_NAME !== undefined || env.AI_PROVIDER === 'fake';
const mapping = !!githubApp && model;
const catalogueEval = model && env.CATALOGUE_EVAL === 'on';
const QUEUES: Record<string, string> = {
  [PersonCreatedV1.type]: 'candidates',
  [RubricApprovedV1.type]: mapping ? EVIDENCE_QUEUE : ASSESSMENT_QUEUE,
  [EvidenceRecordedV1.type]: mapping ? EVIDENCE_QUEUE : ASSESSMENT_QUEUE,
  [EvidenceMappingRequestedV1.type]: EVIDENCE_QUEUE,
  [EvidenceMappedV1.type]: ASSESSMENT_QUEUE,
  // shortcut: nothing consumes these yet (applying from the candidate site is AIV-P3-008), so they dead-letter after the
  // 14-day TTL like PersonCreated.v1 above; that ticket's consumer replaces this note.
  [JobPublishedV1.type]: 'candidates',
  [JobUnpublishedV1.type]: 'candidates',
  [EmailQueuedV1.type]: NOTIFICATIONS_QUEUE,
  // The catalogue draft eval (AIV-P2-048) runs only with a model and CATALOGUE_EVAL=on; otherwise its requests wait in
  // jobs.outbox, and the page says the run could not run once it times out.
  ...(catalogueEval && { [CatalogueEvalRequestedV1.type]: CATALOGUE_EVAL_QUEUE }),
  ...(githubApp && {
    [RepositoryReadRequestedV1.type]: EVIDENCE_QUEUE,
    [RepositoryRefreshRequestedV1.type]: EVIDENCE_QUEUE,
  }),
  // Arrivals queue repository reads (AIV-P1-076) and CV parses (AIV-P1-079), so they are consumed once either is; the
  // other kind's requests wait in evidence.outbox until its integration is configured.
  ...((githubApp || fileReading) && { [ApplicationReceivedV1.type]: EVIDENCE_QUEUE }),
  // CV parsing and document reads (AIV-P1-025, AIV-P1-028): each waits for its file's scan; a clean file runs it, a
  // rejected one ends it.
  ...(fileReading && {
    [CvParseRequestedV1.type]: EVIDENCE_QUEUE,
    [DocumentReadRequestedV1.type]: EVIDENCE_QUEUE,
    // Link reads (AIV-P1-077) are switched on with the other evidence reads.
    [LinkReadRequestedV1.type]: EVIDENCE_QUEUE,
    [FileCleanV1.type]: EVIDENCE_QUEUE,
    [FileRejectedV1.type]: EVIDENCE_QUEUE,
  }),
  // shortcut: EvidenceRequestSent/Opened/Answered/Quiet.v1 (AIV-P1-037) have no queue until the follow-up consumer
  // (AIV-P1-040) maps them; nothing sends a request before its screen (AIV-P1-039), so none are written meanwhile.
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

const senders = new Map<string, ReturnType<typeof relayBus.createSender>>();
const senderFor = (queue: string) => {
  let sender = senders.get(queue);
  if (!sender) senders.set(queue, (sender = relayBus.createSender(queue)));
  return sender;
};

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
  // Scores candidates when their mapped evidence or the job's approved rubric changes (AIV-P1-031).
  [ASSESSMENT_QUEUE]: createAssessmentHandlers({
    audit: createAudit(appDb, now),
    ...createApprovedRubricReads(),
    evidenceForJob: readEvidenceForJobAsSystem,
    applications: createApplicationReads(),
    now,
  }),
};
// The catalogue draft eval (AIV-P2-048, ADR-013 point 12): the golden sets live against this environment's deployment,
// each run within liveTokenCap and the platform eval budget's tokens left today, never a workspace's budget.
if (catalogueEval)
  CONSUMERS[CATALOGUE_EVAL_QUEUE] = [
    createCatalogueEvalHandler({
      now,
      evaluate: async (keys, tokensLeftToday) => {
        const budget = runBudget(tokensLeftToday);
        const ai = createAiClient({ provider: providerFromEnv(process.env), budget });
        return { ...(await evaluateCatalogue(ai, keys)), tokens: budget.used() };
      },
    }),
  ];
// The evidence handlers share the queue, so all wait for the GitHub App: an unknown event type is dead-lettered.
const evidenceHandlers: NonNullable<(typeof CONSUMERS)[string]> = [];
// Rate-limited reads and AI work held back by the daily budget are scheduled with the relay's sender: the worker-only
// identity holding Data Sender (infra/modules/messaging.bicep); the app identity, shared with the web app, stays receive-only.
const scheduler = createScheduler(senderFor);
if (mapping)
  evidenceHandlers.push(
    ...createEvidenceMappingHandlers({
      ai: createAiClient({ provider: providerFromEnv(process.env), budget: createAiTokenBudget(appDb) }),
      ...createApprovedRubricReads(),
      applications: createApplicationReads(),
      readPerson: readPersonAsSystem,
      scheduler,
      now,
    }),
  );
else log.warn('Evidence mapping off: it needs an AI model and the GitHub App; evidence is recorded but not mapped');
if (githubApp || fileReading)
  evidenceHandlers.push(
    createApplicationReceivedHandler({
      readArrival: readApplicationSourceAsSystem,
      readPerson: readPersonAsSystem,
      readFilePurpose: readFilePurposeAsSystem,
      now,
    }),
  );
if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_APP_INSTALLATION_ID) {
  const github = {
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    installationId: env.GITHUB_APP_INSTALLATION_ID,
  };
  evidenceHandlers.push(
    createRepositoryReadHandler({ github, scheduler, now }),
    createRepositoryRefreshHandler({ github, scheduler, now, ...createApprovedRubricReads() }),
  );
}
// shortcut: without the GitHub App, repository reads (and, without CV parsing too, arrivals) wait unsent in their
// outboxes until the owner provisions the app and its Key Vault secrets (AIV-P1-074).
else log.warn('GitHub App not configured: repository reads are not consumed');
if (fileReading && env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT && env.AZURE_STORAGE_BLOB_URL) {
  const ai = createAiClient({ provider: providerFromEnv(process.env), budget: createAiTokenBudget(appDb) });
  evidenceHandlers.push(
    ...createFileReadHandlers({
      db: appDb,
      documentIntelligence: {
        endpoint: env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
        // The app identity holds Cognitive Services User on the AI resource (owner to-do, AIV-P1-025 PR).
        token: async () => {
          const token = await appCredential.getToken('https://cognitiveservices.azure.com/.default');
          if (!token) throw new Error('No Entra token for Document Intelligence');
          return token.token;
        },
      },
      ai,
      readCleanFile: createCleanFileReader(
        createBlobStore({ url: env.AZURE_STORAGE_BLOB_URL, clientId: env.AZURE_CLIENT_ID }),
      ),
      recordContact: createContactRecorder(),
      readPerson: readPersonAsSystem,
      namePerson: nameUnnamedPerson,
      audit: createAudit(appDb, now),
      scheduler,
      now,
    }),
    createLinkReadHandler({ now }),
  );
}
// shortcut: without Document Intelligence, CV parses, document reads and link reads stay pending and their events wait unsent in
// evidence.outbox and files.outbox until the owner sets AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT on the worker (AIV-P1-025
// PR, owner to-dos).
else log.warn('Document Intelligence not configured: CV parses, document reads and link reads are not consumed');
if (evidenceHandlers.length) CONSUMERS[EVIDENCE_QUEUE] = evidenceHandlers;

// Defender's scan results, which Event Grid puts on their own queue (infra/modules/storage.bicep): Event Grid events,
// not outbox envelopes, so not through createConsumer. A settled file ignores a redelivery, so no inbox is needed.
// Invalid bodies are dead-lettered at once; any other failure backs off and is redelivered, up to 10 times.
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
        const subscription = subscribe(
          receiver,
          systemConsumer(
            'Defender scan results; each settles only the file its blob path names, in that workspace',
            async (delivery) => {
              try {
                await files.handleScanResult(delivery.body);
                await delivery.complete();
              } catch (error) {
                if (error instanceof z.ZodError) return delivery.deadLetter('invalid payload');
                log.warn({ err: error, area: 'files' }, 'scan result failed');
                // The consumers' retry table: back off under the lock, then dead-letter after 10 deliveries (AIV-P0-015).
                const settlement = decide('failed', delivery.deliveryCount);
                if (settlement.action === 'deadLetter') return delivery.deadLetter(settlement.reason);
                if (settlement.action === 'abandon')
                  await sleep(settlement.delayMs, undefined, { signal: stop.signal }).catch(() => undefined);
                await delivery.abandon();
              }
            },
          ),
        );
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

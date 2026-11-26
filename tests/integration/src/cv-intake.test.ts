import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createAiClient, fakeProvider } from '@credalent/ai';
import { createAudit } from '@credalent/audit/composition';
import {
  createCandidates,
  createContactRecorder,
  nameUnnamedPerson,
  readPersonAsSystem,
  displayNamesInWorkspace,
} from '@credalent/candidates/composition';
import { createDb, withWorkspace, type Db, type Envelope } from '@credalent/db';
import { createConsumer, type Delivery, type Handler } from '@credalent/db/consumer';
import { createRelay } from '@credalent/db/relay';
import { CvParseRequestedV1, type EvidenceContract } from '@credalent/evidence';
import {
  createApplicationReceivedHandler,
  createFileReadHandlers,
  createEvidence,
  EVIDENCE_QUEUE,
} from '@credalent/evidence/composition';
import { FileCleanV1, FileRejectedV1, type FilesContract } from '@credalent/files';
import {
  createCleanFileReader,
  createFiles,
  readFilePurposeAsSystem,
  type BlobStore,
} from '@credalent/files/composition';
import { ApplicationReceivedV1, type IntakeContract } from '@credalent/intake';
import { receiveConfirmed } from './confirmedBatch.ts';
import { createIntake, readApplicationSourceAsSystem } from '@credalent/intake/composition';
import { createJobs } from '@credalent/jobs/composition';
import type { WorkspaceContext, WorkspacesContract } from '@credalent/workspaces';
import { createAiTokenBudget, createWorkspaces } from '@credalent/workspaces/composition';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { http, HttpResponse } from 'msw';
import { HttpNetworkFrame } from 'msw/experimental';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// AIV-P1-079 acceptance scenarios against real PostgreSQL (as aivera_app): every CV that arrives on an application is
// parsed once, from receiveApplication through ApplicationReceived.v1, the scan's FileClean.v1 or FileRejected.v1 and
// the parse. Document Intelligence is answered by msw from the recorded layout fixture (no live call), the model by the
// fake provider. Synthetic cast and @example.com addresses only (docs/00-product/personas.md).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');
const recorded = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', 'fixtures', 'document-intelligence', 'maria-santos-hidden-text.json'),
    'utf8',
  ),
) as object;

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1';
const NOW = new Date('2026-11-20T09:00:00.000Z');
const DI = 'https://docintel.credalent.example';
const MARIA_STATEMENT = 'Built a document question-answering assistant for an insurance claims team';
const COMPLETION = JSON.stringify({
  contact: { emails: [], phones: [] },
  workHistory: [],
  skills: [],
  statements: [{ text: MARIA_STATEMENT, citations: [{ sourceId: 'S1', quote: MARIA_STATEMENT }] }],
});

// Every upload's bytes carry a marker; the analyze call answers the layout recorded for it.
const layouts = new Map<string, object | 'unavailable'>();
let analyzeCalls = 0;
const docintel = setupServer(
  http.post(`${DI}/documentintelligence/documentModels/prebuilt-layout:analyze`, async ({ request }) => {
    analyzeCalls++;
    const { base64Source } = (await request.json()) as { base64Source: string };
    const marker = Buffer.from(base64Source, 'base64').toString().split(' ')[1] ?? '';
    if (layouts.get(marker) === 'unavailable') return new HttpResponse(null, { status: 504 });
    const location = `${DI}/documentintelligence/documentModels/prebuilt-layout/analyzeResults/${marker}?api-version=2024-11-30`;
    return new HttpResponse(null, { status: 202, headers: { 'operation-location': location } });
  }),
  http.get(`${DI}/documentintelligence/documentModels/prebuilt-layout/analyzeResults/:id`, ({ params }) =>
    HttpResponse.json(layouts.get(String(params['id']))),
  ),
);

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let relayDb: Db;
let workspaces: WorkspacesContract;
let intake: IntakeContract;
let evidence: EvidenceContract;
let files: FilesContract;
let handlers: Handler<unknown>[];
let w1: string;
let w2: string;
let job: string;
const stored = new Map<string, { data: Buffer; contentType: string }>();
const blobs: BlobStore = {
  uploadUrl: async (path) => `https://blob.credalent.example/${path}`,
  readUrl: async (path) => `https://blob.credalent.example/${path}`,
  read: async (path) => {
    const blob = stored.get(path);
    return blob ? { size: blob.data.length, contentType: blob.contentType, data: blob.data } : null;
  },
  write: async (path, data, contentType) => void stored.set(path, { data, contentType }),
  delete: async (path) => void stored.delete(path),
};
const spans = new InMemorySpanExporter();

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
const as = <T>(workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId: ALEX }, workspaceId, fn);

type Upload = { purpose?: 'cv' | 'evidence' | 'portal'; settle?: 'clean' | 'oversized' | 'infected' | 'pending' };

/** Uploads a file as the recruiter's browser would, with the recorded layout as its content, and settles it. */
async function upload({ purpose = 'cv', settle = 'clean' }: Upload = {}): Promise<string> {
  const marker = randomUUID();
  layouts.set(marker, recorded);
  const data = Buffer.from(`%PDF-1.7 ${marker} synthetic`);
  const ticket = await as(w1, (ctx) =>
    files.requestUpload(ctx, { purpose, fileName: 'cv.pdf', contentType: 'application/pdf', size: data.length }),
  );
  // Over the limit: requestUpload refuses a declared size over 10 MB, so an oversized file is a blob larger than the
  // size it declared, which the scan's settle rejects on the size mismatch.
  const blob = settle === 'oversized' ? Buffer.concat([data, Buffer.alloc(1024)]) : data;
  stored.set(`uploads-quarantine/w/${w1}/${ticket.fileId}`, { data: blob, contentType: 'application/pdf' });
  if (settle === 'clean') expect(await as(w1, (ctx) => files.markCleanWithoutScan(ctx, ticket.fileId))).toBe('clean');
  if (settle === 'oversized')
    expect(await as(w1, (ctx) => files.markCleanWithoutScan(ctx, ticket.fileId))).toBe('rejected');
  if (settle === 'infected') {
    const blobUri = `https://blob.credalent.example/uploads-quarantine/w/${w1}/${ticket.fileId}`;
    await files.handleScanResult({
      id: randomUUID(),
      eventType: 'Microsoft.Security.MalwareScanningResult',
      subject: 'storageAccounts/devstoreaccount1',
      eventTime: NOW.toISOString(),
      dataVersion: '1.0',
      data: { correlationId: randomUUID(), blobUri, scanResultType: 'Malicious', scanResultDetails: {} },
    });
    expect(await as(w1, (ctx) => files.getStatus(ctx, ticket.fileId))).toBe('infected');
  }
  return ticket.fileId;
}

const apply = (name: string, fileIds: string[]) =>
  as(w1, (ctx) =>
    receiveConfirmed(intake, ctx, {
      jobId: job,
      person: {
        displayName: name,
        identifiers: [{ type: 'email', value: `${name.toLowerCase().replaceAll(' ', '.')}@example.com` }],
        synthetic: true,
      },
      source: 'careers_page',
      fileIds,
    }),
  );

const TO_EVIDENCE = new Set([
  ApplicationReceivedV1.type,
  CvParseRequestedV1.type,
  FileCleanV1.type,
  FileRejectedV1.type,
]);

/** One relay pass over intake, evidence and files; returns what went to the evidence queue. */
async function relay(): Promise<Envelope[]> {
  const sent: Envelope[] = [];
  await createRelay({
    db: relayDb,
    schemas: ['intake', 'evidence', 'files'],
    queueFor: (type) => (TO_EVIDENCE.has(type) ? EVIDENCE_QUEUE : 'elsewhere'),
    send: async (queue, envelope) => void (queue === EVIDENCE_QUEUE && sent.push(envelope)),
    now: () => NOW,
  })();
  return sent;
}

/** Delivers to the evidence queue's consumer, as Service Bus would on delivery `deliveryCount`. */
async function consume(envelopes: Envelope[], deliveryCount = 1): Promise<string[]> {
  const consumer = createConsumer({ db: app, queue: EVIDENCE_QUEUE, handlers, now: () => NOW });
  const settled: string[] = [];
  for (const body of envelopes)
    await consumer.handle({
      body,
      deliveryCount,
      complete: async () => void settled.push('complete'),
      abandon: async () => void settled.push('abandon'),
      deadLetter: async (reason) => void settled.push(`deadLetter: ${reason}`),
    } satisfies Delivery);
  return settled;
}

/** Relays and consumes until the outboxes are empty: the arrival, then its parse requests, then their evidence. */
async function drain(): Promise<Envelope[]> {
  const all: Envelope[] = [];
  for (let sent = await relay(); sent.length; sent = await relay()) {
    all.push(...sent);
    await consume(sent);
  }
  return all;
}

/** The ApplicationReceived.v1 handler run directly in a worker transaction, past the consumer's inbox. */
const handleDirectly = (envelope: Envelope) => {
  const handler = handlers.find((h) => h.event.type === ApplicationReceivedV1.type);
  if (!handler) throw new Error('no ApplicationReceived.v1 handler');
  return withWorkspace(app, envelope.workspaceId, (tx) => handler.handle(tx, envelope.payload, envelope));
};

type CvRow = { id: string; candidate_id: string; blob_file_id: string; status: string | null };
const cvSources = async (fileId: string) => [
  ...(await withWorkspace(app, w1, (tx) =>
    tx.execute<CvRow>(
      sql`select s.id, s.candidate_id, s.blob_file_id, p.status from evidence.source s
          left join evidence.cv_parse p on p.workspace_id = s.workspace_id and p.source_id = s.id
          where s.kind = 'cv' and s.blob_file_id = ${fileId}`,
    ),
  )),
];
const parseRows = async (fileId: string) =>
  Number(
    (
      await admin.execute<{ n: string }>(
        sql`select count(*) as n from evidence.cv_parse p join evidence.source s on s.id = p.source_id
            where s.blob_file_id = ${fileId}`,
      )
    )[0]?.n,
  );
const parseRequests = async (sourceIds: string[]) =>
  [
    ...(await admin.execute<{ source_id: string }>(
      sql`select payload->>'sourceId' as source_id from evidence.outbox where type = ${CvParseRequestedV1.type}`,
    )),
  ].filter((r) => sourceIds.includes(r.source_id));

beforeAll(async () => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] }));
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  // The concurrency scenario holds two worker transactions at once, and the AI budget reads on its own connection.
  app = createDb(urlFor('aivera_app'), { max: 4 });
  relayDb = createDb(urlFor('aivera_relay'), { max: 1 });
  const audit = createAudit(app);
  workspaces = createWorkspaces(app, audit);
  const jobs = createJobs(workspaces, audit, () => NOW);
  intake = createIntake(
    workspaces,
    createCandidates(workspaces, () => NOW),
    jobs,
    displayNamesInWorkspace,
    audit,
    () => NOW,
  );
  evidence = createEvidence(workspaces, audit, () => NOW);
  files = createFiles({ db: app, workspaces, audit, blobs, malwareScanning: false, now: () => NOW });
  handlers = [
    createApplicationReceivedHandler({
      readArrival: readApplicationSourceAsSystem,
      readPerson: readPersonAsSystem,
      readFilePurpose: readFilePurposeAsSystem,
      now: () => NOW,
    }) as Handler<unknown>,
    ...createFileReadHandlers({
      db: app,
      documentIntelligence: { endpoint: DI, token: async () => 'synthetic-entra-token', wait: async () => undefined },
      ai: createAiClient({ provider: fakeProvider({ completion: COMPLETION }), budget: createAiTokenBudget(app) }),
      readCleanFile: createCleanFileReader(blobs),
      recordContact: createContactRecorder(),
      readPerson: readPersonAsSystem,
      namePerson: nameUnnamedPerson,
      audit,
      scheduler: { schedule: async () => '1', cancel: async () => undefined },
      now: () => NOW,
    }),
  ];
  const create = async (name: string) =>
    (await workspaces.createWorkspace({ name, company: name, hiringFocus: 'AI', synthetic: true, creatorUserId: ALEX }))
      .id;
  w1 = await create('Demo hiring team');
  w2 = await create('Gulf Talent Partners');
  job = await as(
    w1,
    async (ctx) =>
      (
        await jobs.createJob(ctx, {
          title: 'Senior AI Engineer',
          jobType: 'ai_llm_engineering',
          description: 'Senior AI Engineer.',
          synthetic: true,
        })
      ).id,
  );
  // Only once Testcontainers is up: msw patches Node's HTTP stack, which its Docker API calls go through.
  docintel.listen({
    onUnhandledFrame: ({ frame, defaults }) =>
      void (frame instanceof HttpNetworkFrame && frame.data.request.url.startsWith(DI) && defaults.error()),
  });
});

afterAll(async () => {
  docintel.close();
  await app?.$client.end();
  await relayDb?.$client.end();
  await admin?.$client.end();
  await container?.stop();
  trace.disable();
  context.disable();
});

// Set by the first scenario; the later ones build on her parsed CV, so they run with it, not alone.
let maria: { personId: string; fileId: string; sourceId: string };

describe('Scenario: An uploaded CV is parsed and its statements appear as claims', () => {
  it('one cv source for Maria for that file, its statements claims citing "CV, page 1", none counting', async () => {
    const fileId = await upload({ settle: 'pending' });
    const { personId } = await apply('Maria Santos', [fileId]);
    await drain();
    const [pending, ...more] = await cvSources(fileId);
    expect(more).toEqual([]);
    expect(pending).toMatchObject({ candidate_id: personId, status: 'pending' });

    // The scan passes: FileClean.v1 runs the parse that waited for it.
    expect(await as(w1, (ctx) => files.markCleanWithoutScan(ctx, fileId))).toBe('clean');
    await drain();
    const sourceId = pending?.id ?? '';
    expect(await as(w1, (ctx) => evidence.getCvParse(ctx, sourceId))).toMatchObject({ status: 'parsed' });
    const items = await as(w1, (ctx) => evidence.listEvidenceForCandidate(ctx, personId, job));
    expect(items.map((i) => [i.excerpt, `${i.source.label}, ${i.excerptSpan}`, i.provenance, i.strength])).toEqual([
      [MARIA_STATEMENT, 'CV, page 1', 'claim', 'claim'],
    ]);
    maria = { personId, fileId, sourceId };
  });
});

describe('Scenario: The same file redelivered is parsed once', () => {
  // SAFETY: mutation check: removed onConflictDoNothing from cvParseStore.insertOrGet -> this test and the next failed (23505 unique violation)
  it('a redelivered ApplicationReceived.v1 and a second arrival listing the same file keep one source, parse row and event', async () => {
    // A second arrival for Maria lists the same file id; its handler runs through the consumer, then once more past
    // the inbox, as a redelivery the inbox did not catch would.
    await apply('Maria Santos', [maria.fileId]);
    const sent = await relay();
    expect(await consume(sent)).toEqual(['complete']);
    expect(await consume(sent)).toEqual(['complete']);
    await handleDirectly(sent[0] as Envelope);
    await drain();
    expect((await cvSources(maria.fileId)).map((s) => s.id)).toEqual([maria.sourceId]);
    expect(await parseRows(maria.fileId)).toBe(1);
    expect(await parseRequests([maria.sourceId])).toHaveLength(1);
  });

  // SAFETY: mutation check: dropped the unique index source_cv_file_key (emptied 0018) -> this test failed (42P10: no index matches ON CONFLICT)
  it('two deliveries of one arrival at once keep one source, one parse row and one CvParseRequested.v1', async () => {
    const fileId = await upload();
    await apply('Daniel Novak', [fileId]);
    const [envelope] = await relay();
    await Promise.all([handleDirectly(envelope as Envelope), handleDirectly(envelope as Envelope)]);
    const sources = await cvSources(fileId);
    expect(sources).toHaveLength(1);
    expect(await parseRows(fileId)).toBe(1);
    expect(await parseRequests(sources.map((s) => s.id))).toHaveLength(1);
    await drain();
  });
});

describe('Scenario Outline: Files that are not a readable CV are not parsed as one', () => {
  // SAFETY: mutation check: removed the purpose filter in queueArrivalReads -> both rows and the unit test failed (a cv source was created)
  it.each(['evidence', 'portal'] as const)('a file of purpose "%s": no CV parse is queued for it', async (purpose) => {
    const fileId = await upload({ purpose });
    await apply('Maria Santos', [fileId]);
    await drain();
    expect(await cvSources(fileId)).toEqual([]);
  });

  it.each([
    ['a CV over the 10 MB limit, rejected by scan', 'oversized'],
    ['a CV the malware scan rejected', 'infected'],
  ] as const)(
    '%s: its CV source shows "Could not be read automatically" and no parsing job runs',
    async (_, settle) => {
      const fileId = await upload({ settle });
      const calls = analyzeCalls;
      await apply('Maria Santos', [fileId]);
      await drain();
      expect((await cvSources(fileId)).map((s) => s.status)).toEqual(['unreadable']);
      expect(analyzeCalls).toBe(calls);
    },
  );
});

describe("Scenario: A file on another candidate's application is never parsed for this one", () => {
  // SAFETY: mutation check: dropped the source id filter in intake findSource (any arrival of the workspace) -> this test failed (Omar's file not parsed for Omar)
  it("Omar's CV is parsed only for Omar, and Maria's arrival creates no source for it", async () => {
    const omarFile = await upload();
    const omar = await apply('Omar Al Suwaidi', [omarFile]);
    const mariaFile = await upload();
    await apply('Maria Santos', [mariaFile]);
    await drain();
    expect((await cvSources(omarFile)).map((s) => s.candidate_id)).toEqual([omar.personId]);
    expect((await cvSources(mariaFile)).map((s) => s.candidate_id)).toEqual([maria.personId]);
  });
});

describe('Scenario: Workspace isolation holds for the worker', () => {
  // SAFETY: mutation check: disabled (and unforced) row level security on evidence.source -> this test failed (w2 read w1's cv sources)
  it('workspace B reads no cv source with the repository filter removed', async () => {
    expect(await cvSources(maria.fileId)).toHaveLength(1);
    const other = await withWorkspace(app, w2, (tx) =>
      tx.execute(sql`select id from evidence.source where kind = 'cv'`),
    );
    expect([...other]).toEqual([]);
    expect(await as(w2, (ctx) => evidence.getCvParse(ctx, maria.sourceId))).toBeNull();
  });
});

describe('Scenario: No CV text or file names reach logs or telemetry', () => {
  // SAFETY: mutation check: put the content type in the arrival handler's queued message -> this test failed
  it('queued, parsed, retried once and parsed again: logs and spans carry ids only', async () => {
    const lines: string[] = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    });
    spans.reset();
    try {
      const fileId = await upload();
      const marker = [...layouts.keys()].at(-1) ?? '';
      layouts.set(marker, 'unavailable');
      const sara = await apply('Sara Al Qahtani', [fileId]);
      await consume(await relay());
      const parse = (await relay()).filter((e) => e.type === CvParseRequestedV1.type);
      expect(await consume(parse)).toEqual(['abandon']);
      layouts.set(marker, recorded);
      expect(await consume(parse, 2)).toEqual(['complete']);
      await drain();
      const [source] = await cvSources(fileId);
      expect(source?.status).toBe('parsed');

      const out = [
        lines.join(''),
        JSON.stringify(
          spans.getFinishedSpans().map((s) => ({ name: s.name, attributes: s.attributes, events: s.events })),
        ),
      ];
      for (const text of out)
        expect(text).not.toMatch(
          /maria|santos|sara|qahtani|insurance|notebook|@example\.com|cv\.pdf|application\/pdf|synthetic-entra/i,
        );
      const queued = lines
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .find((l) => l['msg'] === 'cv parse queued');
      const standard = new Set(['level', 'time', 'pid', 'hostname', 'trace_id', 'span_id', 'msg']);
      const fields = Object.fromEntries(Object.entries(queued ?? {}).filter(([key]) => !standard.has(key)));
      expect(fields).toEqual({ sourceId: source?.id, candidateId: sara.personId });
    } finally {
      write.mockRestore();
    }
  });
});

describe('Scenario: The worker refuses an arrival with no confirmed batch (AIV-P1-104)', () => {
  // SAFETY: mutation check: removed the batchId guard in queueArrivalReads -> this test failed (a cv source and a parse request were created)
  it('an arrival added with no batch queues no CV parse, repository read or link read', async () => {
    const fileId = await upload();
    const arrival = {
      jobId: job,
      person: {
        displayName: 'Hessa Al Mazrouei',
        identifiers: [{ type: 'email' as const, value: 'hessa.almazrouei@example.com' }],
        synthetic: true,
      },
      source: 'linkedin' as const,
      fileIds: [fileId],
      links: ['https://github.com/hessa-credalent-example/checkout-e2e', 'https://portfolio.credalent.example/hessa'],
    };
    await as(w1, (ctx) => intake.receiveApplication(ctx, arrival));
    await consume(await relay());
    await drain();
    expect(await cvSources(fileId)).toEqual([]);
    expect(await parseRows(fileId)).toBe(0);
    const [seen] = await admin.execute<{ n: number }>(
      sql`select count(*)::int as n from evidence.repository_read where url like '%hessa-credalent-example%'`,
    );
    expect(seen?.n).toBe(0);
  });
});

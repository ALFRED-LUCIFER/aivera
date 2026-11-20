import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createAudit } from '@credalent/audit/composition';
import { createCandidates, readPersonAsSystem } from '@credalent/candidates/composition';
import { createDb, withWorkspace, type Db, type Envelope } from '@credalent/db';
import { createConsumer, type Delivery, type Handler } from '@credalent/db/consumer';
import { createRelay } from '@credalent/db/relay';
import type { EvidenceContract } from '@credalent/evidence';
import { createApplicationReceivedHandler, createEvidence, EVIDENCE_QUEUE } from '@credalent/evidence/composition';
import { ApplicationReceivedV1, type IntakeContract, type ReceiveApplicationInput } from '@credalent/intake';
import { readFilePurposeAsSystem } from '@credalent/files/composition';
import { createIntake, readApplicationSourceAsSystem } from '@credalent/intake/composition';
import type { JobsContract } from '@credalent/jobs';
import { createJobs } from '@credalent/jobs/composition';
import { ForbiddenError, type Role, type WorkspaceContext, type WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// AIV-P1-076 acceptance scenarios against real PostgreSQL (as aivera_app): every GitHub repository link reaching an
// application is read once. The worker's relay and its evidence-queue consumer run in-process; nothing reaches GitHub
// here (the read itself is tests/integration/src/repository-read.test.ts). Synthetic cast only (personas.md).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const AP = '0190d4a2-0000-7000-8000-00000000a1e1';
const RAMI = '0190d4a2-0000-7000-8000-0000000000e1';
const HEAD = '0190d4a2-0000-7000-8000-0000000000e2';
const NOW = new Date('2026-11-20T09:00:00.000Z');
const SARA_REPO = 'https://github.com/sara-credalent-example/merchant-assistant';
const READ_REQUESTED = 'RepositoryReadRequested.v1';

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let relayDb: Db;
let workspaces: WorkspacesContract;
let jobs: JobsContract;
let intake: IntakeContract;
let evidence: EvidenceContract;
let handler: Handler<unknown>;
let failNextArrival = false;
let demo: string;
let other: string;
let sae: string;
let qa: string;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const as = <T>(userId: string, workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId }, workspaceId, fn);

const addMember = (userId: string, role: Role) =>
  withWorkspace(app, demo, (tx) =>
    tx.execute(
      sql`insert into workspaces.member (workspace_id, user_id, role, status) values (${demo}, ${userId}, ${role}, 'active')`,
    ),
  );

const newJob = (title: string) =>
  as(
    AP,
    demo,
    async (ctx) =>
      (await jobs.createJob(ctx, { title, jobType: 'ai_llm_engineering', description: `${title}.`, synthetic: true }))
        .id,
  );

const arrival = (jobId: string, name: string, links: string[], githubLogin?: string): ReceiveApplicationInput => ({
  jobId,
  person: {
    displayName: name,
    identifiers: [{ type: 'email', value: `${name.toLowerCase().replaceAll(' ', '.')}@example.com` }],
    synthetic: true,
  },
  source: 'careers_page',
  links,
  ...(githubLogin && { githubLogin }),
});

/** One relay pass over intake and evidence; each ApplicationReceived.v1 goes to the evidence queue's consumer. */
async function relayAndConsume(): Promise<string[]> {
  const sent: Envelope[] = [];
  await createRelay({
    db: relayDb,
    schemas: ['intake', 'evidence'],
    queueFor: (type) => (type === ApplicationReceivedV1.type ? EVIDENCE_QUEUE : 'elsewhere'),
    send: async (queue, envelope) => void (queue === EVIDENCE_QUEUE && sent.push(envelope)),
    now: () => NOW,
  })();
  const consumer = createConsumer({ db: app, queue: EVIDENCE_QUEUE, handlers: [handler], now: () => NOW });
  const settled: string[] = [];
  for (const envelope of sent)
    for (let deliveryCount = 1; ; deliveryCount++) {
      let outcome = '';
      const delivery: Delivery = {
        body: envelope,
        deliveryCount,
        complete: async () => void (outcome = 'complete'),
        abandon: async () => void (outcome = 'abandon'),
        deadLetter: async (reason) => void (outcome = `deadLetter: ${reason}`),
      };
      await consumer.handle(delivery);
      settled.push(outcome);
      if (outcome !== 'abandon') break;
    }
  return settled;
}

const receive = async (input: ReceiveApplicationInput) => {
  const received = await as(AP, demo, (ctx) => intake.receiveApplication(ctx, input));
  await relayAndConsume();
  return received;
};

type ReadRow = { source_id: string; url: string; github_login: string | null; emails: string[]; status: string };
const reads = async (candidateId: string) => [
  ...(await withWorkspace(app, demo, (tx) =>
    tx.execute<ReadRow>(
      sql`select source_id, url, github_login, emails, status from evidence.repository_read
          where candidate_id = ${candidateId} order by url`,
    ),
  )),
];

const readRequests = async (candidateId: string) =>
  [
    ...(await admin.execute<{ payload: { candidateId: string; sourceId: string } }>(
      sql`select payload from evidence.outbox where type = ${READ_REQUESTED} order by occurred_at, id`,
    )),
  ]
    .map((r) => r.payload)
    .filter((p) => p.candidateId === candidateId);

const count = async (table: string) =>
  Number((await admin.execute<{ n: string }>(sql`select count(*) as n from ${sql.raw(table)}`))[0]?.n);

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 4 });
  relayDb = createDb(urlFor('aivera_relay'), { max: 1 });
  const audit = createAudit(app, () => NOW);
  workspaces = createWorkspaces(app, audit);
  jobs = createJobs(workspaces, audit, () => NOW);
  intake = createIntake(
    workspaces,
    createCandidates(workspaces, () => NOW),
    jobs,
    () => NOW,
  );
  evidence = createEvidence(workspaces, audit, () => NOW);
  handler = createApplicationReceivedHandler({
    readArrival: async (...args) => {
      if (failNextArrival) {
        failNextArrival = false;
        throw new Error('database connection lost');
      }
      return readApplicationSourceAsSystem(...args);
    },
    readPerson: readPersonAsSystem,
    readFilePurpose: readFilePurposeAsSystem,
    now: () => NOW,
  }) as Handler<unknown>;
  const create = async (name: string) =>
    (await workspaces.createWorkspace({ name, company: name, hiringFocus: 'AI', synthetic: true, creatorUserId: AP }))
      .id;
  demo = await create('Demo');
  other = await create('Gulf Talent Partners');
  sae = await newJob('Senior AI Engineer');
  qa = await newJob('QA Automation Engineer');
  await addMember(RAMI, 'interviewer');
  await addMember(HEAD, 'hiring_owner');
  for (const userId of [RAMI, HEAD]) await as(AP, demo, (ctx) => workspaces.grantJobAccess(ctx, { userId, jobId: qa }));
});

afterAll(async () => {
  await app?.$client.end();
  await relayDb?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

let sara: { personId: string; applicationId: string };

describe('Scenario: A repository link on an application queues one read', () => {
  it('stores one pending source with the URL, writes one RepositoryReadRequested.v1 with ids only, matched by her login and the emails on her record', async () => {
    sara = await receive(arrival(sae, 'Sara Al Qahtani', [SARA_REPO], 'sara-credalent-example'));
    const [read, ...more] = await reads(sara.personId);
    expect(more).toEqual([]);
    expect(read).toMatchObject({
      url: SARA_REPO,
      status: 'pending',
      github_login: 'sara-credalent-example',
      emails: ['sara.al.qahtani@example.com'],
    });
    expect(await readRequests(sara.personId)).toEqual([{ candidateId: sara.personId, sourceId: read?.source_id }]);
    const source = await withWorkspace(app, demo, (tx) =>
      tx.execute<{ kind: string; url: string }>(
        sql`select kind, url from evidence.source where id = ${read?.source_id ?? ''}`,
      ),
    );
    expect([...source]).toEqual([{ kind: 'repository', url: SARA_REPO }]);
  });
});

describe('Scenario Outline: The same repository queues one read whatever the path or spelling', () => {
  // SAFETY: mutation check: skip URL normalisation before the lookup (stored input.url as given) -> all three rows failed
  it.each([
    ['a second application', () => receive(arrival(qa, 'Sara Al Qahtani', [SARA_REPO], 'sara-credalent-example'))],
    [
      'the upload portal answers',
      () =>
        receive({
          ...arrival(sae, 'Sara Al Qahtani', ['https://github.com/Sara-Credalent-Example/merchant-assistant.git']),
          source: 'email',
        }),
    ],
    [
      'a link AP adds',
      async () => {
        await as(AP, demo, (ctx) => intake.addLink(ctx, sara.applicationId, `${SARA_REPO}/?tab=readme`));
        await relayAndConsume();
      },
    ],
  ])(
    'through %s: the existing source id is returned and no second RepositoryReadRequested.v1 is written',
    async (_, path) => {
      const [before] = await reads(sara.personId);
      await path();
      expect((await reads(sara.personId)).map((r) => r.source_id)).toEqual([before?.source_id]);
      expect(await readRequests(sara.personId)).toHaveLength(1);
      const again = await as(AP, demo, (ctx) =>
        evidence.requestRepositoryRead(ctx, {
          candidateId: sara.personId,
          url: `${SARA_REPO}.git`,
          githubLogin: 'sara-credalent-example',
          emails: [],
          synthetic: true,
        }),
      );
      expect(again.sourceId).toBe(before?.source_id);
    },
  );

  // SAFETY: mutation check: drop the unique constraint repository_read_candidate_url_key (from 0011 and the schema) -> this test failed (ON CONFLICT had no matching constraint)
  it('two requests at once for the same candidate and repository keep one read and one event', async () => {
    const { personId } = await as(AP, demo, (ctx) =>
      createCandidates(workspaces, () => NOW).findOrCreatePerson(ctx, {
        displayName: 'Daniel Novak',
        identifiers: [{ type: 'email', value: 'daniel.novak@example.com' }],
        synthetic: true,
      }),
    );
    const request = () =>
      as(AP, demo, (ctx) =>
        evidence.requestRepositoryRead(ctx, {
          candidateId: personId,
          url: 'https://github.com/daniel-credalent-example/rag-service',
          githubLogin: 'daniel-credalent-example',
          emails: ['daniel.novak@example.com'],
          synthetic: true,
        }),
      );
    const [a, b] = await Promise.all([request(), request()]);
    expect(a.sourceId).toBe(b.sourceId);
    expect(await reads(personId)).toHaveLength(1);
    expect(await readRequests(personId)).toHaveLength(1);
    const sources = await withWorkspace(app, demo, (tx) =>
      tx.execute(sql`select id from evidence.source where candidate_id = ${personId}`),
    );
    expect(sources).toHaveLength(1);
  });
});

describe('Scenario: A repository URL found in a parsed CV queues a read and stays a claim until read', () => {
  // The CV parser (AIV-P1-025) makes this call for each repository URL it finds; here the URL is fixture input.
  it('one pending read is queued for Arjun, and until it is read nothing from it counts in his backed score', async () => {
    const arjun = await receive(arrival(sae, 'Arjun Menon', []));
    await as(AP, demo, (ctx) =>
      evidence.requestRepositoryRead(ctx, {
        candidateId: arjun.personId,
        url: 'https://github.com/arjun-credalent-example/eval-notebook',
        githubLogin: null,
        emails: ['arjun.menon@example.com'],
        synthetic: true,
      }),
    );
    expect((await reads(arjun.personId)).map((r) => [r.url, r.status])).toEqual([
      ['https://github.com/arjun-credalent-example/eval-notebook', 'pending'],
    ]);
    expect(await as(AP, demo, (ctx) => evidence.listEvidenceForCandidate(ctx, arjun.personId, sae))).toEqual([]);
  });
});

describe('Scenario: No GitHub login supplied', () => {
  it("queues a read matching Maria's record emails only; no login is inferred from her name, email or the owner", async () => {
    const maria = await receive(
      arrival(sae, 'Maria Santos', ['https://github.com/maria-credalent-example/ledger-sync']),
    );
    expect(await reads(maria.personId)).toMatchObject([
      {
        url: 'https://github.com/maria-credalent-example/ledger-sync',
        github_login: null,
        emails: ['maria.santos@example.com'],
      },
    ]);
  });
});

describe('Scenario Outline: A link that is not a GitHub repository is refused and kept as a plain link', () => {
  it.each([
    'https://portfolio.omar.credalent.example/projects',
    'https://gitlab.com/omar-credalent-example/payments',
    'https://github.com/omar-credalent-example',
  ])('%s: no read is queued and the link stays on the application', async (link) => {
    const omar = await receive(arrival(sae, 'Omar Al Suwaidi', []));
    const { sourceId } = await as(AP, demo, (ctx) => intake.addLink(ctx, omar.applicationId, link));
    expect(await relayAndConsume()).toEqual(['complete']);
    expect(await reads(omar.personId)).toEqual([]);
    expect(await readRequests(omar.personId)).toEqual([]);
    const kept = await withWorkspace(app, demo, (tx) =>
      tx.execute<{ source: string; links: string[] }>(
        sql`select source, links from intake.application_source where id = ${sourceId}`,
      ),
    );
    expect([...kept]).toEqual([{ source: 'recruiter', links: [link] }]);
  });
});

describe('Scenario Outline: Only people who can reach the job can add a link', () => {
  // SAFETY: mutation check: remove the job-scope check in addLink (the jobResource lookup and authorize) -> both rows failed (the link was stored and queued)
  it.each([
    ['Rami Panel', 'an interviewer', RAMI],
    ['Head of Quality', 'a hiring owner', HEAD],
  ])(
    '%s, %s granted only "QA Automation Engineer", is refused with 403 and nothing is stored, queued or audited',
    async (_, __, userId) => {
      const tables = ['intake.application_source', 'intake.outbox', 'evidence.repository_read', 'audit.entry'];
      const before = await Promise.all(tables.map(count));
      await expect(as(userId, demo, (ctx) => intake.addLink(ctx, sara.applicationId, SARA_REPO))).rejects.toThrow(
        ForbiddenError,
      );
      expect(await Promise.all(tables.map(count))).toEqual(before);
    },
  );

  it('on a job they are granted, an interviewer can add a link', async () => {
    const qaApplicant = await as(AP, demo, (ctx) =>
      intake.receiveApplication(ctx, arrival(qa, 'Hessa Al Mazrouei', [])),
    );
    await expect(
      as(RAMI, demo, (ctx) =>
        intake.addLink(ctx, qaApplicant.applicationId, 'https://github.com/hessa-credalent-example/checkout-e2e'),
      ),
    ).resolves.toEqual({ sourceId: expect.any(String) });
    await relayAndConsume();
    expect(await reads(qaApplicant.personId)).toHaveLength(1);
  });
});

describe('Scenario: Repository links never reach logs or telemetry', () => {
  // SAFETY: mutation check: log the source URL in the queue handler (in the message template) -> this test failed
  it('the queue, a failed and retried delivery, and the refusals log opaque ids only', async () => {
    const lines: string[] = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      const layla = await as(AP, demo, (ctx) =>
        intake.receiveApplication(
          ctx,
          arrival(
            sae,
            'Layla Haddad',
            ['https://github.com/layla-credalent-example/merchant-assistant'],
            'layla-credalent-example',
          ),
        ),
      );
      failNextArrival = true;
      expect(await relayAndConsume()).toEqual(['abandon', 'complete']);
      await as(AP, demo, (ctx) =>
        intake.addLink(ctx, layla.applicationId, 'https://gitlab.com/layla-credalent-example/x'),
      );
      await relayAndConsume();
      await as(RAMI, demo, (ctx) => intake.addLink(ctx, layla.applicationId, SARA_REPO)).catch(() => undefined);
      const all = lines.join('');
      for (const value of ['github.com', 'gitlab.com', 'merchant-assistant', 'credalent-example', '@example.com'])
        expect(all).not.toContain(value);
      const [read] = await reads(layla.personId);
      const queued = lines.find((line) => line.includes('"repository read queued"'));
      expect(queued).toContain(read?.source_id);
      expect(queued).toContain(layla.personId);
      expect(lines.some((line) => line.includes('"message handler failed"'))).toBe(true);
    } finally {
      write.mockRestore();
    }
  });
});

describe('Row-level security', () => {
  it("another workspace reads none of Demo's repository reads or application sources, even with no WHERE clause", async () => {
    for (const table of ['evidence.repository_read', 'intake.application_source'])
      expect([...(await withWorkspace(app, other, (tx) => tx.execute(sql`select * from ${sql.raw(table)}`)))]).toEqual(
        [],
      );
  });
});

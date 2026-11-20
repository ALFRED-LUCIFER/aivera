import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createAudit } from '@credalent/audit/composition';
import type { CandidatesContract } from '@credalent/candidates';
import { createCandidates } from '@credalent/candidates/composition';
import { createDb, withWorkspace, type Db, type Envelope } from '@credalent/db';
import { createConsumer, type Delivery, type Handler } from '@credalent/db/consumer';
import { createRelay } from '@credalent/db/relay';
import { RepositoryReadRequestedV1, type EvidenceContract } from '@credalent/evidence';
import { createEvidence, createRepositoryReadHandler, EVIDENCE_QUEUE } from '@credalent/evidence/composition';
import { ForbiddenError, type WorkspaceContext, type WorkspacesContract } from '@credalent/workspaces';
import { createWorkspaces } from '@credalent/workspaces/composition';
import { sql } from 'drizzle-orm';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P1-026 acceptance scenarios: the worker job `evidence.repository.read` against real PostgreSQL (as aivera_app)
// and GitHub's REST API recorded as msw fixtures on a synthetic host, so no request can reach github.com. Synthetic
// cast and `<firstname>-credalent-example` logins only (docs/00-product/personas.md).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@credalent/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');

const ALEX = '0190d4a2-0000-7000-8000-00000000a1e1';
const LINA = '0190d4a2-0000-7000-8000-0000000011aa';
const JOB = '0190d4a2-0000-7000-8000-000000000b01';
const NOW = new Date('2026-11-12T09:00:00.000Z');
const API = 'https://api.github.credalent.example';
const en = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', '..', 'packages', 'i18n', 'messages', 'en.json'), 'utf8'),
) as { evidence: { repositoryStatus: Record<string, string> } };

// --- Recorded GitHub fixtures -------------------------------------------------------------------------------------

type FixtureCommit = { sha: string; login: string | null; email: string; message: string; files: string[] };
type FixtureRepo = { fork?: boolean; commits: FixtureCommit[]; paths?: string[] };
type FixturePull = { owner: string; name: string; number: number; mergedBy: string };

const repos = new Map<string, FixtureRepo>();
const pulls = new Map<string, FixturePull[]>();
const forks = new Set<string>();
const scheduled: { queue: string; envelope: Envelope; at: Date }[] = [];
let rateLimitNext = false;
let commitCalls = 0;
let seq = 0;

/** `n` commits shaped by `by`: newest first, as GitHub lists them. */
const commits = (n: number, by: Partial<FixtureCommit>): FixtureCommit[] =>
  Array.from({ length: n }, () => ({
    sha: (++seq).toString(16).padStart(40, '0'),
    login: null,
    email: 'someone@example.com',
    message: 'Change the evaluation runner',
    files: ['src/runner.py'],
    ...by,
  }));

const ghCommit = (c: FixtureCommit) => ({
  sha: c.sha,
  commit: {
    author: { name: 'Synthetic', email: c.email, date: '2026-10-01T10:00:00Z' },
    committer: { name: 'GitHub', email: 'noreply@github.com', date: '2026-10-01T10:00:00Z' },
    message: c.message,
  },
  author: c.login ? { login: c.login, id: 1, type: 'User' } : null,
  parents: [],
});

const rateLimited = () =>
  new HttpResponse(JSON.stringify({ message: 'API rate limit exceeded' }), {
    status: 403,
    headers: {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(Math.floor(NOW.getTime() / 1000) + 15 * 60),
    },
  });

const github = setupServer(
  http.post(`${API}/app/installations/:id/access_tokens`, () =>
    HttpResponse.json({ token: 'ghs_synthetic_test_token', expires_at: '2026-11-12T10:00:00Z' }, { status: 201 }),
  ),
  http.get(`${API}/*`, () => (rateLimitNext ? ((rateLimitNext = false), rateLimited()) : undefined)),
  http.get(`${API}/repos/:owner/:repo`, ({ params }) => {
    const key = `${String(params['owner'])}/${String(params['repo'])}`;
    const repo = repos.get(key);
    if (!repo && !forks.has(key)) return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
    return HttpResponse.json({
      full_name: key,
      owner: { login: params['owner'] },
      private: false,
      fork: forks.has(key) || repo?.fork === true,
      default_branch: 'main',
      pushed_at: '2026-11-11T10:00:00Z',
    });
  }),
  http.get(`${API}/repos/:owner/:repo/languages`, () => HttpResponse.json({ Python: 120_400, Shell: 2_100 })),
  http.get(`${API}/repos/:owner/:repo/git/trees/:ref`, ({ params }) =>
    HttpResponse.json({
      truncated: false,
      tree: (repos.get(`${String(params['owner'])}/${String(params['repo'])}`)?.paths ?? ['README.md']).map((path) => ({
        path,
        type: 'blob',
      })),
    }),
  ),
  http.get(`${API}/repos/:owner/:repo/commits`, ({ params, request }) => {
    commitCalls++;
    const all = repos.get(`${String(params['owner'])}/${String(params['repo'])}`)?.commits ?? [];
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? '1');
    const next = page * 100 < all.length;
    url.searchParams.set('page', String(page + 1));
    return HttpResponse.json(all.slice((page - 1) * 100, page * 100).map(ghCommit), {
      headers: next ? { link: `<${url.href}>; rel="next"` } : {},
    });
  }),
  http.get(`${API}/repos/:owner/:repo/commits/:sha`, ({ params }) => {
    const all = repos.get(`${String(params['owner'])}/${String(params['repo'])}`)?.commits ?? [];
    const found = all.find((c) => c.sha === params['sha']);
    if (!found) return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
    return HttpResponse.json({ ...ghCommit(found), files: found.files.map((filename) => ({ filename })) });
  }),
  http.get(`${API}/search/issues`, ({ request }) => {
    const q = new URL(request.url).searchParams.get('q') ?? '';
    const login = /author:(\S+)/.exec(q)?.[1] ?? '';
    const items = (pulls.get(login) ?? []).map((pr) => ({
      number: pr.number,
      repository_url: `${API}/repos/${pr.owner}/${pr.name}`,
      pull_request: { merged_at: '2026-10-03T12:00:00Z' },
    }));
    return HttpResponse.json({ total_count: items.length, incomplete_results: false, items });
  }),
  http.get(`${API}/repos/:owner/:repo/pulls/:number`, ({ params }) => {
    const pr = [...pulls.values()]
      .flat()
      .find(
        (p) =>
          `${p.owner}/${p.name}#${p.number}` ===
          `${String(params['owner'])}/${String(params['repo'])}#${String(params['number'])}`,
      );
    if (!pr) return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
    return HttpResponse.json({
      number: pr.number,
      merged_at: '2026-10-03T12:00:00Z',
      merged_by: { login: pr.mergedBy },
    });
  }),
);

// --- Database and modules -----------------------------------------------------------------------------------------

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let relayDb: Db;
let workspaces: WorkspacesContract;
let candidates: CandidatesContract;
let evidence: EvidenceContract;
let handler: Handler<unknown>;
let w1: string;
let w2: string;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const as = <T>(userId: string, workspaceId: string, fn: (ctx: WorkspaceContext) => Promise<T>) =>
  workspaces.withWorkspace({ userId }, workspaceId, fn);

const person = (displayName: string) =>
  as(ALEX, w1, async (ctx) => {
    const email = `${displayName.toLowerCase().replaceAll(' ', '.')}@example.com`;
    const created = await candidates.findOrCreatePerson(ctx, {
      displayName,
      identifiers: [{ type: 'email', value: email }],
      synthetic: true,
    });
    return { id: created.personId, email };
  });

/** One relay pass; every RepositoryReadRequested.v1 it sends goes to the worker's consumer for the evidence queue. */
async function relayAndConsume(): Promise<string[]> {
  const sent: Envelope[] = [];
  await createRelay({
    db: relayDb,
    schemas: ['evidence'],
    queueFor: (type) => (type === RepositoryReadRequestedV1.type ? EVIDENCE_QUEUE : 'assessment'),
    send: async (queue, envelope) => void (queue === EVIDENCE_QUEUE && sent.push(envelope)),
    now: () => NOW,
  })();
  return consume(sent);
}

async function consume(envelopes: Envelope[]): Promise<string[]> {
  const consumer = createConsumer({ db: app, queue: EVIDENCE_QUEUE, handlers: [handler], now: () => NOW });
  const settled: string[] = [];
  for (const envelope of envelopes) {
    const delivery: Delivery = {
      body: envelope,
      deliveryCount: 1,
      complete: async () => void settled.push('complete'),
      abandon: async () => void settled.push('abandon'),
      deadLetter: async (reason) => void settled.push(`deadLetter: ${reason}`),
    };
    await consumer.handle(delivery);
  }
  return settled;
}

/** Requests a read of `owner/name` for `who`, runs the worker, and returns what was stored. */
async function read(who: { id: string; email: string }, login: string, owner: string, name: string) {
  const { sourceId } = await as(ALEX, w1, (ctx) =>
    evidence.requestRepositoryRead(ctx, {
      candidateId: who.id,
      url: `https://github.com/${owner}/${name}`,
      githubLogin: login,
      emails: [who.email],
      synthetic: true,
    }),
  );
  const settled = await relayAndConsume();
  const view = await as(ALEX, w1, (ctx) => evidence.getRepositoryRead(ctx, sourceId));
  const items = (await as(ALEX, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, who.id, JOB))).filter(
    (i) => i.sourceId === sourceId,
  );
  return { sourceId, settled, view, items };
}

const mergedPullRequests = async (candidateId: string) =>
  [
    ...(await withWorkspace(app, w1, (tx) =>
      tx.execute<{ repository: string; number: number; merged_by: string; self_merged: boolean; merged_at: Date }>(
        sql`select repository, number, merged_by, self_merged, merged_at from evidence.merged_pull_request
            where candidate_id = ${candidateId} order by repository, number`,
      ),
    )),
  ].map((r) => ({ ...r, merged_at: new Date(r.merged_at).toISOString() }));

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 1 });
  relayDb = createDb(urlFor('aivera_relay'), { max: 1 });
  workspaces = createWorkspaces(app, createAudit(app));
  candidates = createCandidates(workspaces, () => NOW);
  evidence = createEvidence(workspaces, () => NOW);
  // A throwaway key made per run: the token endpoint is msw, so nothing real is ever signed (AGENTS.md 1.11).
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  handler = createRepositoryReadHandler({
    github: {
      appId: '1000001',
      installationId: '2000002',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      apiUrl: API,
    },
    scheduler: {
      schedule: async (queue, envelope, at) => (scheduled.push({ queue, envelope, at }), String(scheduled.length)),
      cancel: async () => undefined,
    },
    now: () => NOW,
  }) as Handler<unknown>;
  const create = (name: string) =>
    workspaces.createWorkspace({ name, company: name, hiringFocus: 'AI', synthetic: true, creatorUserId: ALEX });
  w1 = (await create('Demo hiring team')).id;
  w2 = (await create('Gulf Talent Partners')).id;
  await withWorkspace(app, w1, (tx) =>
    tx.execute(
      sql`insert into workspaces.member (workspace_id, user_id, role, status) values (${w1}, ${LINA}, 'interviewer', 'active')`,
    ),
  );
  // Only once Testcontainers is up: msw patches Node's HTTP stack, which its Docker API calls go through (EPIPE in CI).
  // Every GitHub request must hit a fixture.
  github.listen({ onUnhandledRequest: (request, print) => void (request.url.startsWith(API) && print.error()) });
});

afterAll(async () => {
  github.close();
  await app?.$client.end();
  await relayDb?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

// --- Scenarios ----------------------------------------------------------------------------------------------------

const SARA = 'sara-credalent-example';

describe('Scenario: Authorship is measured from commit history (with generated-only commits counted apart)', () => {
  it('records "authored 412 of 460 commits, 38 only touch generated files", "Commit history, checked 12 Nov" and a share of 374 of 460', async () => {
    const sara = await person('Sara Al Qahtani');
    repos.set(`${SARA}/llm-eval-harness`, {
      paths: ['README.md', 'src/runner.py', 'tests/test_runner.py', '.github/workflows/ci.yml'],
      commits: [
        ...commits(30, { login: SARA, files: ['poetry.lock'] }),
        ...commits(8, { login: SARA, files: ['vendor/tokenizer/vocab.txt', 'poetry.lock'] }),
        ...commits(10, { email: sara.email }),
        ...commits(5, {
          login: 'rami-credalent-example',
          message: `Pair on the scorer\n\nCo-authored-by: Sara <${sara.email}>`,
        }),
        ...commits(359, { login: SARA }),
        ...commits(48, { login: 'rami-credalent-example' }),
      ],
    });
    const { settled, view, items } = await read(sara, SARA, SARA, 'llm-eval-harness');
    expect(settled).toEqual(['complete']);
    // The generated-only check covers the newest 300 of her 412 commits and says so (the ticket's shortcut).
    expect(items).toMatchObject([
      {
        excerpt: 'authored 412 of 460 commits, 38 only touch generated files (checked 300 of 412)',
        provenance: 'submitted',
        strength: 'medium',
        source: { kind: 'repository', checkMethod: 'Commit history', checkedAt: NOW },
      },
    ]);
    expect(view).toMatchObject({
      status: 'read',
      totalCommits: 460,
      authoredCommits: 412,
      generatedOnlyCommits: 38,
      generatedChecked: 300,
      share: { numerator: 374, denominator: 460 },
      authorship: 'clear',
      strengthCap: 'strong',
      languages: { Python: 120_400, Shell: 2_100 },
      pushedAt: new Date('2026-11-11T10:00:00Z'),
      hasTests: true,
      hasCi: true,
    });
  });
});

describe('Scenario: Shared authorship is recorded as shared', () => {
  it("Arjun's eval notebook, with his and a colleague's commits in similar numbers, cannot back Strong", async () => {
    const arjun = await person('Arjun Menon');
    repos.set('arjun-credalent-example/eval-notebook', {
      commits: [
        ...commits(49, { login: 'arjun-credalent-example' }),
        ...commits(47, { login: 'priya-credalent-example' }),
      ],
    });
    const { view, items } = await read(arjun, 'arjun-credalent-example', 'arjun-credalent-example', 'eval-notebook');
    expect(view).toMatchObject({
      authorship: 'shared',
      strengthCap: 'medium',
      share: { numerator: 49, denominator: 96 },
    });
    expect(items.map((i) => i.strength)).toEqual(['medium']);
  });
});

describe('Scenario: A private or missing repository', () => {
  it('a link that answers 404 is "not accessible", with the copy "This repository is private or no longer exists", and nothing is scored', async () => {
    const layla = await person('Layla Haddad');
    const { settled, view, items } = await read(
      layla,
      'layla-credalent-example',
      'layla-credalent-example',
      'arabic-ocr',
    );
    expect(settled).toEqual(['complete']);
    expect(view).toMatchObject({ status: 'not_accessible', share: null, strengthCap: null, totalCommits: null });
    expect(items).toEqual([]);
    expect(en.evidence.repositoryStatus.not_accessible).toBe('This repository is private or no longer exists');
  });
});

describe('Scenario: Rate limit reached', () => {
  it('reschedules the read for after the reset on Service Bus, completes the delivery and shows no error', async () => {
    const daniel = await person('Daniel Novak');
    repos.set('daniel-credalent-example/rag-service', { commits: commits(12, { login: 'daniel-credalent-example' }) });
    rateLimitNext = true;
    const before = scheduled.length;
    const first = await read(daniel, 'daniel-credalent-example', 'daniel-credalent-example', 'rag-service');
    expect(first.settled).toEqual(['complete']);
    expect(first.view).toMatchObject({ status: 'pending' });
    expect(first.items).toEqual([]);
    const [again] = scheduled.slice(before);
    expect(again).toMatchObject({
      queue: EVIDENCE_QUEUE,
      at: new Date(NOW.getTime() + 15 * 60_000 + 1000),
      envelope: { type: RepositoryReadRequestedV1.type, workspaceId: w1, payload: { sourceId: first.sourceId } },
    });

    // At the reset Service Bus delivers it, and the read completes; a duplicate of it afterwards changes nothing.
    expect(await consume([again?.envelope as Envelope])).toEqual(['complete']);
    const after = await as(ALEX, w1, (ctx) => evidence.getRepositoryRead(ctx, first.sourceId));
    expect(after).toMatchObject({ status: 'read', authoredCommits: 12, totalCommits: 12 });
    await consume([{ ...(again?.envelope as Envelope), id: crypto.randomUUID() }]);
    const items = await as(ALEX, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, daniel.id, JOB));
    expect(items).toHaveLength(1);
  });
});

describe('Scenario: README claims are not evidence of authorship', () => {
  it('a README saying "I built all of this" with 3 of 200 commits by the candidate records "authored 3 of 200 commits"', async () => {
    const priya = await person('Priya Nair');
    repos.set('priya-credalent-example/agent-kit', {
      paths: ['README.md', 'agent/core.py'],
      commits: [
        ...commits(3, { login: 'priya-credalent-example' }),
        ...commits(197, { login: 'hessa-credalent-example' }),
      ],
    });
    const { view, items } = await read(priya, 'priya-credalent-example', 'priya-credalent-example', 'agent-kit');
    expect(items.map((i) => [i.excerpt, i.strength])).toEqual([['authored 3 of 200 commits', 'supporting']]);
    expect(view).toMatchObject({ authorship: 'minor', strengthCap: 'supporting' });
  });
});

describe('Scenario: A fork is never counted as authored work', () => {
  // SAFETY: mutation check: count forks as authored (dropped `!meta.fork` from the measure condition in readRepository) -> "a fork is never counted as authored work" failed
  it('a fork is never counted as authored work', async () => {
    const maria = await person('Maria Santos');
    repos.set('maria-credalent-example/vector-store', {
      fork: true,
      commits: [
        ...commits(4, { login: 'maria-credalent-example' }),
        ...commits(1240, { login: 'upstream-credalent-example' }),
      ],
    });
    const calls = commitCalls;
    const { view, items } = await read(maria, 'maria-credalent-example', 'maria-credalent-example', 'vector-store');
    expect(view).toMatchObject({
      status: 'fork',
      authoredCommits: null,
      totalCommits: null,
      share: null,
      strengthCap: null,
    });
    expect(items).toEqual([]);
    expect(commitCalls).toBe(calls);
    expect(en.evidence.repositoryStatus.fork).toBe(
      "This repository is a fork. Forked code is not counted as the candidate's work.",
    );
  });
});

describe('Scenario: Owning a repository is not authorship', () => {
  // SAFETY: mutation check: credit the repository owner with all commits (authored = commits when repo.owner is the login) -> "owning a repository is not authorship" failed
  it('owning a repository is not authorship', async () => {
    const omar = await person('Omar Al Suwaidi');
    repos.set('omar-credalent-example/kyc-reader', { commits: commits(120, { login: 'anjali-credalent-example' }) });
    const { view, items } = await read(omar, 'omar-credalent-example', 'omar-credalent-example', 'kyc-reader');
    expect(items.map((i) => i.excerpt)).toEqual(['authored 0 of 120 commits']);
    expect(view).toMatchObject({ authoredCommits: 0, share: { numerator: 0, denominator: 120 } });
  });
});

describe('Scenario: Bulk lockfile commits cannot make authorship look strong', () => {
  // SAFETY: mutation check: include generated-only commits in the authorship share (numerator = authoredCommits) -> "bulk lockfile commits cannot make authorship look strong" failed
  it('bulk lockfile commits cannot make authorship look strong', async () => {
    const rana = await person('Rana Khoury');
    repos.set('rana-credalent-example/pricing-sim', {
      commits: [
        ...commits(250, { login: 'rana-credalent-example', files: ['package-lock.json'] }),
        ...commits(50, { login: 'rana-credalent-example', files: ['src/sim.ts', 'package-lock.json'] }),
        ...commits(100, { login: 'karim-credalent-example' }),
      ],
    });
    const { view } = await read(rana, 'rana-credalent-example', 'rana-credalent-example', 'pricing-sim');
    expect(view?.share).toEqual({ numerator: 50, denominator: 400 });
    expect(view?.strengthCap).not.toBe('strong');
  });
});

describe("Scenario: Merged pull requests into someone else's repository are their own items", () => {
  const TAREK = 'tarek-credalent-example';
  const MAINTAINER = 'saga-maintainer-credalent-example';
  let tarek: { id: string; email: string };

  it('records 3 merged pull-request items with repository, number, merged date and merger; kept apart from commits; none corroborated', async () => {
    tarek = await person('Tarek Mansour');
    repos.set(`${TAREK}/saga-examples`, { commits: commits(10, { login: TAREK }) });
    repos.set(`${MAINTAINER}/saga`, { commits: [] });
    forks.add('orbit-credalent-example/saga-fork');
    pulls.set(TAREK, [
      { owner: MAINTAINER, name: 'saga', number: 41, mergedBy: MAINTAINER },
      { owner: MAINTAINER, name: 'saga', number: 57, mergedBy: MAINTAINER },
      { owner: MAINTAINER, name: 'saga', number: 63, mergedBy: MAINTAINER },
      // Neither counts: his own repository, and a fork.
      { owner: TAREK, name: 'saga-examples', number: 2, mergedBy: TAREK },
      { owner: 'orbit-credalent-example', name: 'saga-fork', number: 1, mergedBy: 'orbit-credalent-example' },
    ]);
    const { view, sourceId } = await read(tarek, TAREK, TAREK, 'saga-examples');
    const items = await as(ALEX, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, tarek.id, JOB));
    const merged = (n: number) => ({
      repository: `${MAINTAINER}/saga`,
      number: n,
      merged_by: MAINTAINER,
      self_merged: false,
      merged_at: '2026-10-03T12:00:00.000Z',
    });
    expect(await mergedPullRequests(tarek.id)).toEqual([merged(41), merged(57), merged(63)]);
    expect(view).toMatchObject({ authoredCommits: 10, totalCommits: 10, share: { numerator: 10, denominator: 10 } });
    expect(items.map((i) => i.excerpt).toSorted()).toEqual([
      `Pull request #41 to ${MAINTAINER}/saga, merged on 2026-10-03 by ${MAINTAINER}`,
      `Pull request #57 to ${MAINTAINER}/saga, merged on 2026-10-03 by ${MAINTAINER}`,
      `Pull request #63 to ${MAINTAINER}/saga, merged on 2026-10-03 by ${MAINTAINER}`,
      'authored 10 of 10 commits',
    ]);
    expect(items.every((i) => i.provenance === 'submitted')).toBe(true);
    // Each pull request cites the upstream repository it was merged into, not the repository that was read.
    const prSources = items.filter((i) => i.sourceId !== sourceId).map((i) => i.source);
    expect(prSources).toHaveLength(3);
    expect(new Set(prSources.map((src) => src.id)).size).toBe(1);
    expect(prSources[0]).toMatchObject({
      kind: 'repository',
      url: `https://github.com/${MAINTAINER}/saga`,
      checkMethod: 'Merged pull request',
      checkedAt: NOW,
    });
  });

  it('a pull request Tarek authored and merged himself is recorded as self-merged, and the three are not recorded twice', async () => {
    repos.set(`${TAREK}/outbox-demo`, { commits: commits(4, { login: TAREK }) });
    repos.set('ledger-credalent-example/ledger', { commits: [] });
    pulls.get(TAREK)?.push({ owner: 'ledger-credalent-example', name: 'ledger', number: 9, mergedBy: TAREK });
    const before = (await as(ALEX, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, tarek.id, JOB))).length;
    const { items } = await read(tarek, TAREK, TAREK, 'outbox-demo');
    expect(items.map((i) => i.excerpt)).toEqual(['authored 4 of 4 commits']);
    const all = await as(ALEX, w1, (ctx) => evidence.listEvidenceForCandidate(ctx, tarek.id, JOB));
    expect(all).toHaveLength(before + 2);
    expect(all.find((i) => i.excerptSpan === 'ledger-credalent-example/ledger#9')?.excerpt).toBe(
      'Pull request #9 to ledger-credalent-example/ledger, merged on 2026-10-03 by the candidate (self-merged)',
    );
    expect((await mergedPullRequests(tarek.id)).map((r) => [r.number, r.merged_by, r.self_merged])).toEqual([
      [9, TAREK, true],
      [41, MAINTAINER, false],
      [57, MAINTAINER, false],
      [63, MAINTAINER, false],
    ]);
  });
});

describe('Row-level security and authorisation', () => {
  // SAFETY: mutation check: ALTER POLICY repository_read_tenant_isolation and merged_pull_request_tenant_isolation USING (true) WITH CHECK (true) -> this test failed (W2 saw W1's rows)
  it("W2 reads none of W1's repository reads or merged pull requests, even with no WHERE clause", async () => {
    for (const table of ['repository_read', 'merged_pull_request', 'inbox'])
      expect([
        ...(await withWorkspace(app, w2, (tx) =>
          tx.execute(sql`select * from ${sql.identifier('evidence')}.${sql.identifier(table)}`),
        )),
      ]).toEqual([]);
    const seen = await withWorkspace(app, w1, (tx) =>
      tx.execute<{ n: string }>(sql`select count(*) as n from evidence.merged_pull_request`),
    );
    expect(Number(seen[0]?.n)).toBeGreaterThan(0);
  });

  it('an interviewer cannot request a read, and a link off github.com or a bad login is refused', async () => {
    const hessa = await person('Hessa Al Mazrouei');
    const input = {
      candidateId: hessa.id,
      url: 'https://github.com/hessa-credalent-example/checkout-e2e',
      githubLogin: 'hessa-credalent-example',
      emails: [hessa.email],
      synthetic: true,
    };
    await expect(as(LINA, w1, (ctx) => evidence.requestRepositoryRead(ctx, input))).rejects.toThrow(ForbiddenError);
    await expect(
      as(ALEX, w1, (ctx) =>
        evidence.requestRepositoryRead(ctx, { ...input, url: 'https://code.credalent.example/hessa/checkout-e2e' }),
      ),
    ).rejects.toThrow('A repository link must be https://github.com/');
    await expect(
      as(ALEX, w1, (ctx) => evidence.requestRepositoryRead(ctx, { ...input, githubLogin: 'not a login' })),
    ).rejects.toThrow('The GitHub login is not valid');
  });
});

describe("The demo seed's reset", () => {
  it('purges repository reads and merged pull requests with the rest of the evidence', async () => {
    await as(ALEX, w1, (ctx) => evidence.purgeSyntheticEvidence(ctx));
    for (const table of ['repository_read', 'merged_pull_request', 'item', 'source'])
      expect([
        ...(await withWorkspace(app, w1, (tx) =>
          tx.execute(sql`select 1 from ${sql.identifier('evidence')}.${sql.identifier(table)}`),
        )),
      ]).toEqual([]);
  });
});

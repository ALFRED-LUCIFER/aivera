import type { Tx } from '@credalent/db';
import type { WorkspaceContext } from '@credalent/workspaces';
import { EvidenceError, type EvidenceItem, type EvidenceSource, type Strength } from '../domain/evidence.ts';
import {
  AUTHORSHIP_LIMIT,
  authorshipExcerpt,
  authorshipShare,
  classifyAuthorship,
  COMMIT_LIST_CAP,
  detectTestsAndCi,
  GENERATED_CHECK_CAP,
  isAuthoredBy,
  isGeneratedOnly,
  isGitHubLogin,
  isSelfMerged,
  itemStrength,
  MERGED_PULL_REQUEST_LIMIT,
  mergedPullRequestExcerpt,
  normaliseLogin,
  parseRepositoryUrl,
  STRENGTH_CAP,
  type AuthorshipClass,
  type Commit,
  type MergedPullRequest,
  type RepositoryReadStatus,
} from '../domain/repository.ts';
import type { Ports } from './evidence.ts';

/** GitHub answered "rate limit reached"; the job is rescheduled for `resetAt` (x-ratelimit-reset). */
export class GitHubRateLimited extends Error {
  readonly resetAt: Date;
  constructor(resetAt: Date) {
    super('GitHub rate limit reached');
    this.name = 'GitHubRateLimited';
    this.resetAt = resetAt;
  }
}

export type GitHubRepository = { fork: boolean; private: boolean; defaultBranch: string; pushedAt: Date | null };

/** The public GitHub REST API, every answer zod-checked by the adapter. Throws GitHubRateLimited. */
export type GitHubPort = {
  /** Null when GitHub answers 404 (private, missing or renamed away). */
  repository(owner: string, name: string): Promise<GitHubRepository | null>;
  languages(owner: string, name: string): Promise<Record<string, number>>;
  /** Every file path on `ref`, for tests and CI detection; no file contents. */
  paths(owner: string, name: string, ref: string): Promise<string[]>;
  /** The newest commits on the default branch, newest first, at most `limit`. */
  commits(owner: string, name: string, limit: number): Promise<{ commits: Commit[]; truncated: boolean }>;
  changedPaths(owner: string, name: string, sha: string): Promise<string[]>;
  /** Pull requests `login` authored that were merged, from search (`author:<login> is:pr is:merged`). */
  mergedPullRequests(login: string): Promise<{ owner: string; name: string; number: number }[]>;
  pullRequest(owner: string, name: string, number: number): Promise<{ mergedAt: Date; mergedBy: string | null } | null>;
};

/** A repository read: what to match commits to, and what was measured. Measured fields are null until read. */
export type RepositoryRead = {
  workspaceId: string;
  sourceId: string;
  candidateId: string;
  githubLogin: string;
  emails: string[];
  status: RepositoryReadStatus;
  totalCommits: number | null;
  authoredCommits: number | null;
  generatedOnlyCommits: number | null;
  generatedChecked: number | null;
  commitsTruncated: boolean | null;
  languages: Record<string, number> | null;
  pushedAt: Date | null;
  hasTests: boolean | null;
  hasCi: boolean | null;
};

export type MergedPullRequestRow = MergedPullRequest & {
  workspaceId: string;
  itemId: string;
  candidateId: string;
  selfMerged: boolean;
};

/** Over one workspace-scoped transaction; every method filters by `workspaceId`. */
export type RepositoryReadStore = {
  insert(read: RepositoryRead): Promise<void>;
  find(workspaceId: string, sourceId: string): Promise<{ read: RepositoryRead; source: EvidenceSource } | null>;
  /** Stores the outcome and marks the source checked at `checkedAt` by `checkMethod`. */
  finish(read: RepositoryRead, checkedAt: Date, checkMethod: string | null): Promise<void>;
  insertItems(items: EvidenceItem[], pulls: MergedPullRequestRow[]): Promise<void>;
  /** "owner/name#12" for every merged pull request already recorded for the candidate. */
  knownPullRequests(workspaceId: string, candidateId: string): Promise<Set<string>>;
};

export type RepositoryPorts = Pick<Ports, 'storeFor' | 'publishRecorded' | 'authorize' | 'newId' | 'now'> & {
  readStoreFor(tx: Tx): RepositoryReadStore;
  /** Writes `RepositoryReadRequested.v1` to the outbox in `tx`. */
  publishReadRequested(tx: Tx, source: EvidenceSource): Promise<void>;
};

export type RequestRepositoryReadInput = {
  candidateId: string;
  /** https://github.com/<owner>/<repository>; only public repositories are read. */
  url: string;
  githubLogin: string;
  /** Emails the candidate verified with us; commits by these count as theirs. */
  emails: string[];
  synthetic: boolean;
};

export type RepositoryReadView = Omit<RepositoryRead, 'githubLogin' | 'emails'> & {
  /** Null unless read: nothing is scored from a fork or an inaccessible repository. */
  share: { numerator: number; denominator: number } | null;
  authorship: AuthorshipClass | null;
  strengthCap: Strength | null;
};

const CHECK_METHOD = 'Commit history';

function measured(read: RepositoryRead) {
  const { totalCommits, authoredCommits, generatedOnlyCommits, generatedChecked, commitsTruncated } = read;
  if (read.status !== 'read' || totalCommits === null || authoredCommits === null) return null;
  return {
    totalCommits,
    authoredCommits,
    generatedOnlyCommits: generatedOnlyCommits ?? 0,
    generatedChecked: generatedChecked ?? 0,
    truncated: commitsTruncated ?? false,
  };
}

export function repositoryReadUseCases(ports: RepositoryPorts) {
  const { storeFor, readStoreFor, publishReadRequested, authorize, newId, now } = ports;
  return {
    /** Stores a pending repository source and asks the worker to read it (`evidence.repository.read`). */
    async requestRepositoryRead(
      ctx: WorkspaceContext,
      input: RequestRepositoryReadInput,
    ): Promise<{ sourceId: string }> {
      await authorize(ctx, 'candidate.create');
      const repo = parseRepositoryUrl(input.url);
      if (!repo) throw new EvidenceError('repository_url');
      const githubLogin = normaliseLogin(input.githubLogin);
      if (!isGitHubLogin(githubLogin)) throw new EvidenceError('github_login');
      const at = now();
      const source: EvidenceSource = {
        id: newId(),
        workspaceId: ctx.workspaceId,
        candidateId: input.candidateId,
        kind: 'repository',
        label: repo.name,
        url: `https://github.com/${repo.owner}/${repo.name}`,
        blobFileId: null,
        capturedAt: at,
        checkedAt: null,
        checkMethod: null,
        synthetic: input.synthetic,
        createdAt: at,
      };
      await storeFor(ctx.tx).insert(source, [], []);
      await readStoreFor(ctx.tx).insert({
        workspaceId: ctx.workspaceId,
        sourceId: source.id,
        candidateId: input.candidateId,
        githubLogin,
        emails: [...new Set(input.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))],
        status: 'pending',
        totalCommits: null,
        authoredCommits: null,
        generatedOnlyCommits: null,
        generatedChecked: null,
        commitsTruncated: null,
        languages: null,
        pushedAt: null,
        hasTests: null,
        hasCi: null,
      });
      await publishReadRequested(ctx.tx, source);
      return { sourceId: source.id };
    },

    async getRepositoryRead(ctx: WorkspaceContext, sourceId: string): Promise<RepositoryReadView | null> {
      await authorize(ctx, 'candidate.view');
      const found = await readStoreFor(ctx.tx).find(ctx.workspaceId, sourceId);
      if (!found) return null;
      const { githubLogin: _login, emails: _emails, ...read } = found.read;
      const authorship = measured(found.read);
      const cls = authorship && classifyAuthorship(authorship);
      return {
        ...read,
        share: authorship && authorshipShare(authorship),
        authorship: cls,
        strengthCap: cls && STRENGTH_CAP[cls],
      };
    },
  };
}

/**
 * The worker job `evidence.repository.read`: reads the repository and the candidate's merged pull requests, then
 * stores everything in `tx` at the end, so a GitHubRateLimited or failed call midway writes nothing. A source no
 * longer pending (a redelivery, or a rescheduled duplicate) is left alone.
 */
export async function readRepository(
  ports: Pick<RepositoryPorts, 'readStoreFor' | 'publishRecorded' | 'newId' | 'now'> & { github: GitHubPort },
  tx: Tx,
  workspaceId: string,
  sourceId: string,
): Promise<void> {
  const { readStoreFor, publishRecorded, newId, now, github } = ports;
  const store = readStoreFor(tx);
  const found = await store.find(workspaceId, sourceId);
  if (!found || found.read.status !== 'pending') return;
  const { read, source } = found;
  const who = { login: read.githubLogin, emails: read.emails };
  const repo = source.url ? parseRepositoryUrl(source.url) : null;
  const meta = repo && (await github.repository(repo.owner, repo.name));
  if (!repo || !meta || meta.private) return store.finish({ ...read, status: 'not_accessible' }, now(), null);
  // A fork is never the candidate's authored work; their work there counts only through merged pull requests.
  if (meta.fork) return store.finish({ ...read, status: 'fork' }, now(), null);

  const [languages, paths, { commits, truncated }] = await Promise.all([
    github.languages(repo.owner, repo.name),
    github.paths(repo.owner, repo.name, meta.defaultBranch),
    github.commits(repo.owner, repo.name, COMMIT_LIST_CAP),
  ]);
  const authored = commits.filter((c) => isAuthoredBy(c, who));
  const checked = authored.slice(0, GENERATED_CHECK_CAP);
  let generatedOnly = 0;
  for (const commit of checked)
    if (isGeneratedOnly(await github.changedPaths(repo.owner, repo.name, commit.sha))) generatedOnly++;
  const authorship = {
    totalCommits: commits.length,
    authoredCommits: authored.length,
    generatedOnlyCommits: generatedOnly,
    generatedChecked: checked.length,
    truncated,
  };
  const pulls = await mergedElsewhere(github, who.login, await store.knownPullRequests(workspaceId, read.candidateId));

  const checkedAt = now();
  const base = {
    workspaceId,
    sourceId,
    candidateId: read.candidateId,
    synthetic: source.synthetic,
    createdAt: checkedAt,
  };
  const items: EvidenceItem[] = [
    {
      ...base,
      id: newId(),
      excerpt: authorshipExcerpt(authorship),
      excerptSpan: null,
      provenance: 'submitted',
      strength: itemStrength(authorship),
      limit: AUTHORSHIP_LIMIT,
    },
  ];
  const pullRows: MergedPullRequestRow[] = pulls.map((pr) => {
    const id = newId();
    items.push({
      ...base,
      id,
      excerpt: mergedPullRequestExcerpt(pr, who.login),
      excerptSpan: `${pr.repository}#${pr.number}`,
      provenance: 'submitted',
      // Corroboration by another maintainer's merge is decided in AIV-P1-029, not here.
      strength: 'supporting',
      limit: MERGED_PULL_REQUEST_LIMIT,
    });
    return { ...pr, workspaceId, itemId: id, candidateId: read.candidateId, selfMerged: isSelfMerged(pr, who.login) };
  });
  await store.finish(
    {
      ...read,
      ...detectTestsAndCi(paths),
      status: 'read',
      totalCommits: authorship.totalCommits,
      authoredCommits: authorship.authoredCommits,
      generatedOnlyCommits: generatedOnly,
      generatedChecked: checked.length,
      commitsTruncated: truncated,
      languages,
      pushedAt: meta.pushedAt,
    },
    checkedAt,
    CHECK_METHOD,
  );
  await store.insertItems(items, pullRows);
  await publishRecorded(
    tx,
    source,
    items.map((i) => i.id),
  );
}

// shortcut: reads the first 100 merged pull requests search returns; page further when a pilot candidate has more.
async function mergedElsewhere(github: GitHubPort, login: string, known: Set<string>): Promise<MergedPullRequest[]> {
  const found = (await github.mergedPullRequests(login)).filter(
    (pr) => pr.owner.toLowerCase() !== login && !known.has(`${pr.owner}/${pr.name}#${pr.number}`),
  );
  const forks = new Map<string, boolean>();
  const pulls: MergedPullRequest[] = [];
  for (const pr of found) {
    const repository = `${pr.owner}/${pr.name}`;
    if (!forks.has(repository)) forks.set(repository, (await github.repository(pr.owner, pr.name))?.fork ?? true);
    if (forks.get(repository)) continue;
    const detail = await github.pullRequest(pr.owner, pr.name, pr.number);
    if (detail) pulls.push({ repository, number: pr.number, ...detail });
  }
  return pulls;
}

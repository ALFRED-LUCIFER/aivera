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
  isStale,
  type RepositoryReadStatus,
} from '../domain/repository.ts';
import {
  classifySkill,
  COVERAGE_GAPS,
  type Citation,
  type Coverage,
  type CoverageGap,
  fileSignals,
  type GradeReason,
  isIgnoredPath,
  pathSignals,
  selectFiles,
  type SkillGrade,
  type SkillSignal,
  targetSkills,
} from '../domain/skill-signals/classify.ts';
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
  /** Every file on `ref` with its size in bytes, and whether GitHub truncated the listing; no file contents. */
  tree(
    owner: string,
    name: string,
    ref: string,
  ): Promise<{ entries: { path: string; size?: number | undefined }[]; truncated: boolean }>;
  /** One file's text on `ref`, or null when it is gone or is not a file (a symlink, a submodule). */
  fileText(owner: string, name: string, path: string, ref: string): Promise<string | null>;
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
  /** Files in the listing outside ignored paths (AIV-P1-072); null until read. */
  filesInspected: number | null;
  /** Why the skill-signal scan did not cover the whole listing; null when it did, or until read. */
  coverageGap: CoverageGap | null;
};

/** A source's stored grade for one target skill of one rubric version (AIV-P1-072). */
export type SkillGradeRow = {
  competencyId: string;
  skill: string;
  grade: SkillGrade;
  reason: GradeReason;
  citations: Citation[];
};

/** The recruiter copy keys are `evidence.skillGrade.*`; NO_EVIDENCE and UNABLE_TO_VERIFY are never negative signals. */
export type SkillGradeView = SkillGradeRow & {
  repositorySourceId: string;
  filesInspected: number;
  citations: (Citation & { repositorySourceId: string })[];
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
  /** The candidate's repository reads that are no longer pending, with their sources, locked for this transaction. */
  lockForCandidate(
    workspaceId: string,
    candidateId: string,
  ): Promise<{ read: RepositoryRead; source: EvidenceSource }[]>;
  /**
   * Stores the outcome and its skill signals (replacing earlier ones) and marks the source checked at `checkedAt` by
   * `checkMethod`, only while the read still has status `from`; false when another delivery changed it first.
   */
  finish(
    read: RepositoryRead,
    checkedAt: Date,
    checkMethod: string | null,
    from: RepositoryReadStatus,
    signals: SkillSignal[],
  ): Promise<boolean>;
  /** Replaces the skill signals and coverage of a read whose file reads were cut short by the rate limit. */
  saveSkillSignals(read: RepositoryRead, signals: SkillSignal[]): Promise<void>;
  /** Each of the candidate's read sources (not pending) with its coverage and stored skill signals. */
  skillInputs(
    workspaceId: string,
    candidateId: string,
  ): Promise<{ sourceId: string; coverage: Coverage; signals: SkillSignal[] }[]>;
  /** Replaces the source's grades for the rubric version. */
  replaceGrades(workspaceId: string, sourceId: string, rubricVersionId: string, grades: SkillGradeRow[]): Promise<void>;
  listGrades(workspaceId: string, candidateId: string, rubricVersionId: string): Promise<SkillGradeView[]>;
  /** Inserts `source` (unless null), then its items and merged pull requests. */
  insertItems(source: EvidenceSource | null, items: EvidenceItem[], pulls: MergedPullRequestRow[]): Promise<void>;
  /** "owner/name#12" for every merged pull request already recorded for the candidate. */
  knownPullRequests(workspaceId: string, candidateId: string): Promise<Set<string>>;
};

export type RepositoryPorts = Pick<Ports, 'storeFor' | 'publishRecorded' | 'authorize' | 'newId' | 'now'> & {
  readStoreFor(tx: Tx): RepositoryReadStore;
  /** Writes `RepositoryReadRequested.v1` to the outbox in `tx`. */
  publishReadRequested(tx: Tx, source: EvidenceSource): Promise<void>;
  /** Writes `RepositoryRefreshRequested.v1` to the outbox in `tx`. */
  publishRefreshRequested(
    tx: Tx,
    request: { workspaceId: string; candidateId: string; jobId: string; at: Date },
  ): Promise<void>;
};

export type RequestRepositoryReadInput = {
  candidateId: string;
  /** https://github.com/<owner>/<repository>; only public repositories are read. */
  url: string;
  githubLogin: string;
  /** Emails the candidate verified with us, zod-checked by the caller; commits by these count as theirs. */
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
const PULL_REQUEST_CHECK_METHOD = 'Merged pull request';

function authorshipOf(read: RepositoryRead) {
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
  const { storeFor, readStoreFor, publishReadRequested, publishRefreshRequested, authorize, newId, now } = ports;
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
        textFingerprint: null,
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
        filesInspected: null,
        coverageGap: null,
      });
      await publishReadRequested(ctx.tx, source);
      return { sourceId: source.id };
    },

    async getRepositoryRead(ctx: WorkspaceContext, sourceId: string): Promise<RepositoryReadView | null> {
      await authorize(ctx, 'candidate.view');
      const found = await readStoreFor(ctx.tx).find(ctx.workspaceId, sourceId);
      if (!found) return null;
      const { githubLogin: _login, emails: _emails, ...read } = found.read;
      const authorship = authorshipOf(found.read);
      const cls = authorship && classifyAuthorship(authorship);
      return {
        ...read,
        share: authorship && authorshipShare(authorship),
        authorship: cls,
        strengthCap: cls && STRENGTH_CAP[cls],
      };
    },

    /** Queues `evidence.repository.refresh-stale` for the candidate on the job (`RepositoryRefreshRequested.v1`). */
    async requestRepositoryRefresh(ctx: WorkspaceContext, candidateId: string, jobId: string): Promise<void> {
      await authorize(ctx, 'candidate.create');
      await publishRefreshRequested(ctx.tx, { workspaceId: ctx.workspaceId, candidateId, jobId, at: now() });
    },

    async listRepositorySkillGrades(
      ctx: WorkspaceContext,
      candidateId: string,
      rubricVersionId: string,
    ): Promise<SkillGradeView[]> {
      await authorize(ctx, 'candidate.view');
      return readStoreFor(ctx.tx).listGrades(ctx.workspaceId, candidateId, rubricVersionId);
    },
  };
}

type WorkerPorts = Pick<RepositoryPorts, 'readStoreFor' | 'publishRecorded' | 'newId' | 'now'> & { github: GitHubPort };

/** The approved rubric version of a job and its competencies, read in the worker's transaction (jobs module). */
export type ApprovedRubricPort = (
  tx: Tx,
  workspaceId: string,
  jobId: string,
) => Promise<{ id: string; competencies: { id: string; name: string; evidenceExpected: string }[] } | null>;

type Found = { read: RepositoryRead; source: EvidenceSource };

/**
 * The worker job `evidence.repository.read`: reads the repository, its skill signals and the candidate's merged pull
 * requests, then stores everything in `tx` at the end, so a GitHubRateLimited or failed call midway writes nothing. A
 * source no longer pending (a redelivery, or a rescheduled duplicate) is left alone, except one whose file reads the
 * rate limit cut short: only its files are read again. Returns when to try again when the rate limit cut them short.
 */
// shortcut: every GitHub call (up to ~400 for a large repository) runs inside the consumer's workspace transaction and
// message lock (auto-renewed by the Service Bus SDK); fetch before opening the write transaction if pilot reads hold a
// connection too long or outlive the lock.
export async function readRepository(
  ports: WorkerPorts,
  tx: Tx,
  workspaceId: string,
  sourceId: string,
): Promise<{ retryAt: Date | null }> {
  const store = ports.readStoreFor(tx);
  const found = await store.find(workspaceId, sourceId);
  if (found?.read.status === 'pending') return readSource(ports, tx, found);
  if (found?.read.status === 'read' && found.read.coverageGap === 'rate_limited') return rereadFiles(ports, tx, found);
  return { retryAt: null };
}

/**
 * The worker job `evidence.repository.refresh-stale` (AIV-P1-072), run before a decision pack rests on the candidate's
 * repository evidence (AIV-P2-010 enqueues it): re-reads each stale source (one metadata call per source decides), then
 * grades every read source against the job's approved rubric version. A rate limit anywhere throws GitHubRateLimited, so
 * nothing is written and the job is rescheduled.
 */
export async function refreshStaleRepositorySources(
  ports: WorkerPorts & { approvedRubric: ApprovedRubricPort },
  tx: Tx,
  workspaceId: string,
  candidateId: string,
  jobId: string,
): Promise<void> {
  // shortcut: holds FOR UPDATE locks on the candidate's reads across every GitHub call of the refresh, inside the
  // consumer transaction; fetch before locking if pilot refreshes hold connections or locks too long.
  const { github, now, approvedRubric } = ports;
  const store = ports.readStoreFor(tx);
  for (const found of await store.lockForCandidate(workspaceId, candidateId)) {
    const repo = found.source.url ? parseRepositoryUrl(found.source.url) : null;
    if (!repo) continue;
    const meta = await github.repository(repo.owner, repo.name);
    if (!isStale(found.source, now(), meta?.pushedAt ?? null)) continue;
    // A refresh whose file reads the rate limit cut short is retried whole, so no grade rests on a partial scan.
    const { retryAt } = await readSource(ports, tx, found, meta);
    if (retryAt) throw new GitHubRateLimited(retryAt);
  }
  const rubric = await approvedRubric(tx, workspaceId, jobId);
  if (rubric) {
    const targets = targetSkills(rubric.competencies);
    for (const { sourceId, coverage, signals } of await store.skillInputs(workspaceId, candidateId))
      await store.replaceGrades(
        workspaceId,
        sourceId,
        rubric.id,
        targets.map(({ competencyId, skill }) => ({ competencyId, ...classifySkill(skill, signals, coverage) })),
      );
  }
}

/** Reads one repository source, pending or (on a refresh) stale; `known` is its metadata when the caller has it. */
async function readSource(
  ports: WorkerPorts,
  tx: Tx,
  found: Found,
  known?: GitHubRepository | null,
): Promise<{ retryAt: Date | null }> {
  const { publishRecorded, newId, now, github } = ports;
  const store = ports.readStoreFor(tx);
  const { read, source } = found;
  const { workspaceId, sourceId } = read;
  const who = { login: read.githubLogin, emails: read.emails };
  const repo = source.url ? parseRepositoryUrl(source.url) : null;
  const meta = known !== undefined ? known : repo && (await github.repository(repo.owner, repo.name));
  // A fork or an inaccessible repository is never measured; the candidate's work counts there only through pull
  // requests merged upstream, which are read whatever this repository turns out to be.
  const measured = repo && meta && !meta.private && !meta.fork ? await measure(github, repo, meta, who) : null;
  const pulls = await mergedElsewhere(github, who.login, await store.knownPullRequests(workspaceId, read.candidateId));

  const checkedAt = now();
  const base = { workspaceId, candidateId: read.candidateId, synthetic: source.synthetic, createdAt: checkedAt };
  const status = measured ? 'read' : meta && !meta.private ? 'fork' : 'not_accessible';
  const finished = await store.finish(
    { ...read, ...(measured?.read ?? { filesInspected: null, coverageGap: 'unreadable' }), status },
    checkedAt,
    measured ? CHECK_METHOD : null,
    read.status,
    measured?.signals ?? [],
  );
  if (!finished) return { retryAt: null };
  if (measured) {
    const item: EvidenceItem = {
      ...base,
      sourceId,
      id: newId(),
      excerpt: authorshipExcerpt(measured.authorship),
      excerptSpan: null,
      provenance: 'submitted',
      strength: itemStrength(measured.authorship),
      limit: AUTHORSHIP_LIMIT,
    };
    await store.insertItems(null, [item], []);
    // A re-read is a new event for the same source, so it needs its own key; the earlier item stays as history.
    // shortcut: a re-read appends an authorship item and both list under the source; AIV-P1-027 and the evidence-profile
    // tickets must show only the newest per source.
    const key = read.status === 'pending' ? undefined : `source:${sourceId}:${checkedAt.toISOString()}`;
    await publishRecorded(tx, source, [item.id], key);
  }

  // Each upstream repository is the source its merged pull requests cite, never the repository read above.
  for (const repository of new Set(pulls.map((pr) => pr.repository))) {
    const prSource: EvidenceSource = {
      ...base,
      id: newId(),
      kind: 'repository',
      label: repository.split('/')[1] ?? repository,
      url: `https://github.com/${repository}`,
      blobFileId: null,
      capturedAt: checkedAt,
      checkedAt,
      checkMethod: PULL_REQUEST_CHECK_METHOD,
      textFingerprint: null,
    };
    const items: EvidenceItem[] = [];
    const rows: MergedPullRequestRow[] = [];
    for (const pr of pulls.filter((p) => p.repository === repository)) {
      const id = newId();
      items.push({
        ...base,
        sourceId: prSource.id,
        id,
        excerpt: mergedPullRequestExcerpt(pr, who.login),
        excerptSpan: `${pr.repository}#${pr.number}`,
        provenance: 'submitted',
        // Corroboration by another maintainer's merge is decided in AIV-P1-029, not here.
        strength: 'supporting',
        limit: MERGED_PULL_REQUEST_LIMIT,
      });
      rows.push({
        ...pr,
        workspaceId,
        itemId: id,
        candidateId: read.candidateId,
        selfMerged: isSelfMerged(pr, who.login),
      });
    }
    await store.insertItems(prSource, items, rows);
    await publishRecorded(
      tx,
      prSource,
      items.map((i) => i.id),
    );
  }
  return { retryAt: measured?.retryAt ?? null };
}

/**
 * Reads the files of a read the rate limit cut short again, keeping its commit measurements. Grades are not redone
 * here: every refresh grades every read source again.
 */
async function rereadFiles(ports: WorkerPorts, tx: Tx, { read, source }: Found): Promise<{ retryAt: Date | null }> {
  const repo = source.url ? parseRepositoryUrl(source.url) : null;
  const meta = repo && (await ports.github.repository(repo.owner, repo.name));
  if (!repo || !meta || meta.private || meta.fork) return { retryAt: null };
  const tree = await ports.github.tree(repo.owner, repo.name, meta.defaultBranch);
  const scan = await readSkillSignals(ports.github, repo, meta.defaultBranch, tree);
  await ports.readStoreFor(tx).saveSkillSignals({ ...read, ...scan.coverage }, scan.signals);
  return { retryAt: scan.retryAt };
}

/**
 * Skill signals from the listing and the bounded set of files `selectFiles` picks (AIV-P1-072). File contents stay in
 * memory and are dropped here; only signals are returned. A rate limit during the file reads ends them and is recorded
 * as the coverage gap, with when to try again.
 */
async function readSkillSignals(
  github: GitHubPort,
  repo: { owner: string; name: string },
  ref: string,
  tree: Awaited<ReturnType<GitHubPort['tree']>>,
): Promise<{
  signals: SkillSignal[];
  coverage: { filesInspected: number; coverageGap: CoverageGap | null };
  retryAt: Date | null;
}> {
  const { selected, capped, oversized } = selectFiles(tree.entries);
  const signals = pathSignals(tree.entries.map((e) => e.path));
  const gaps = new Set<CoverageGap>();
  let retryAt: Date | null = null;
  for (const path of selected) {
    let text: string | null;
    try {
      text = await github.fileText(repo.owner, repo.name, path, ref);
    } catch (error) {
      if (!(error instanceof GitHubRateLimited)) throw error;
      gaps.add('rate_limited');
      retryAt = error.resetAt;
      break;
    }
    if (text === null) gaps.add('unreadable');
    else signals.push(...fileSignals(path, text));
  }
  if (tree.truncated) gaps.add('truncated_listing');
  if (capped) gaps.add('file_cap');
  if (oversized.length) gaps.add('oversized_file');
  return {
    signals,
    coverage: {
      filesInspected: tree.entries.filter((e) => !isIgnoredPath(e.path)).length,
      coverageGap: COVERAGE_GAPS.find((gap) => gaps.has(gap)) ?? null,
    },
    retryAt,
  };
}

async function measure(
  github: GitHubPort,
  repo: { owner: string; name: string },
  meta: GitHubRepository,
  who: { login: string; emails: string[] },
) {
  const [languages, tree, { commits, truncated }] = await Promise.all([
    github.languages(repo.owner, repo.name),
    github.tree(repo.owner, repo.name, meta.defaultBranch),
    github.commits(repo.owner, repo.name, COMMIT_LIST_CAP),
  ]);
  const authored = commits.filter((c) => isAuthoredBy(c, who));
  const checked = authored.slice(0, GENERATED_CHECK_CAP);
  let generatedOnly = 0;
  for (const commit of checked)
    if (isGeneratedOnly(await github.changedPaths(repo.owner, repo.name, commit.sha))) generatedOnly++;
  const scan = await readSkillSignals(github, repo, meta.defaultBranch, tree);
  const authorship = {
    totalCommits: commits.length,
    authoredCommits: authored.length,
    generatedOnlyCommits: generatedOnly,
    generatedChecked: checked.length,
    truncated,
  };
  return {
    authorship,
    signals: scan.signals,
    retryAt: scan.retryAt,
    read: {
      ...detectTestsAndCi(tree.entries.map((e) => e.path)),
      ...scan.coverage,
      totalCommits: authorship.totalCommits,
      authoredCommits: authorship.authoredCommits,
      generatedOnlyCommits: generatedOnly,
      generatedChecked: checked.length,
      commitsTruncated: truncated,
      languages,
      pushedAt: meta.pushedAt,
    },
  };
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

import type { Tx } from '@credalent/db';
import {
  chooseProfileRepositories,
  PROFILE_REPOSITORY_CAP,
  type ProfileExpansionStatus,
} from '../domain/repository.ts';
import type { GitHubPort, RequestRepositoryReadInput } from './repositoryRead.ts';

/**
 * A GitHub profile a CV links (AIV-P1-112). `login` is candidate personal data: it stays in the row, never in an event,
 * a log line or a span.
 */
export type ProfileExpansion = {
  workspaceId: string;
  id: string;
  candidateId: string;
  /** Lower case. */
  login: string;
  synthetic: boolean;
  status: ProfileExpansionStatus;
  /** Repository reads the expansion queued; null until it has run. */
  queued: number | null;
};

/** Over one workspace-scoped transaction; every method filters by `workspaceId`. */
export type ProfileExpansionStore = {
  /** Inserts the pending expansion unless the candidate already has one for the login; true when inserted. */
  insertIfNew(expansion: ProfileExpansion): Promise<boolean>;
  find(workspaceId: string, id: string): Promise<ProfileExpansion | null>;
  /** Sets the outcome only while pending; false when another delivery settled it first. */
  settle(
    workspaceId: string,
    id: string,
    status: Exclude<ProfileExpansionStatus, 'pending'>,
    queued: number,
  ): Promise<boolean>;
  /** Repository reads the candidate already has that came from a profile, whichever expansion queued them. */
  profileReads(workspaceId: string, candidateId: string): Promise<number>;
  /** Waits for, then holds until commit, the candidate's lock, so expansions of one candidate run one at a time. */
  lockCandidate(workspaceId: string, candidateId: string): Promise<void>;
};

export type ExpansionQueuePorts = {
  profileStoreFor(tx: Tx): ProfileExpansionStore;
  /** Writes `GitHubProfileExpandRequested.v1` to the outbox in `tx`. */
  publishExpandRequested(tx: Tx, expansion: ProfileExpansion, occurredAt: Date): Promise<void>;
  newId(): string;
  now(): Date;
};

/** Stores a pending expansion and queues it, once per candidate and login: a second request queues nothing. */
export async function queueProfileExpansion(
  ports: ExpansionQueuePorts,
  tx: Tx,
  workspaceId: string,
  input: { candidateId: string; login: string; synthetic: boolean },
): Promise<boolean> {
  const expansion: ProfileExpansion = { ...input, workspaceId, id: ports.newId(), status: 'pending', queued: null };
  if (!(await ports.profileStoreFor(tx).insertIfNew(expansion))) return false;
  await ports.publishExpandRequested(tx, expansion, ports.now());
  return true;
}

export type ExpandPorts = Pick<ExpansionQueuePorts, 'profileStoreFor'> & {
  github: Pick<GitHubPort, 'user' | 'ownedRepositories'>;
  /** `queueRepositoryRead` as the system, in `tx`: `queued` is false for a repository the candidate already has. */
  queueRead(tx: Tx, workspaceId: string, input: RequestRepositoryReadInput): Promise<{ queued: boolean }>;
};

/**
 * The worker job `evidence.github.profile-expand`: queues an ordinary repository read for the profile's best own public
 * repositories, newest push first, only for a person (an organisation's repositories are not the candidate's). No login
 * and no emails go with a read: a profile in a CV is the candidate's own unverified statement, so it never lifts the
 * authorship cap. A repository the candidate already has a read of is skipped and the next takes its slot. Throws
 * GitHubRateLimited before writing anything. Returns null when another delivery already settled it.
 */
// shortcut: a duplicate merge (AIV-P1-018) does not move a pending expansion to the surviving person, so it queues reads
// on the merged-away record; move `profile_expansion` rows in `mergeRecords` if pilot merges happen while one is pending.
export async function expandProfile(
  ports: ExpandPorts,
  tx: Tx,
  workspaceId: string,
  expansionId: string,
): Promise<{ status: Exclude<ProfileExpansionStatus, 'pending'>; queued: number; candidateId: string } | null> {
  const store = ports.profileStoreFor(tx);
  const first = await store.find(workspaceId, expansionId);
  if (first?.status !== 'pending') return null;
  // Both profiles of one CV run at once on the worker; the 5-repository cap counts what the other committed.
  await store.lockCandidate(workspaceId, first.candidateId);
  const found = await store.find(workspaceId, expansionId);
  if (found?.status !== 'pending') return null;
  const { candidateId, login, synthetic } = found;
  const settle = async (status: 'expanded' | 'not_expandable', queued: number) =>
    (await store.settle(workspaceId, expansionId, status, queued)) ? { status, queued, candidateId } : null;

  if ((await ports.github.user(login))?.type !== 'User') return settle('not_expandable', 0);
  const names = chooseProfileRepositories(await ports.github.ownedRepositories(login));
  const room = PROFILE_REPOSITORY_CAP - (await store.profileReads(workspaceId, candidateId));
  let queued = 0;
  for (const name of names) {
    if (queued >= room) break;
    const read = await ports.queueRead(tx, workspaceId, {
      candidateId,
      url: `https://github.com/${login}/${name}`,
      githubLogin: null,
      emails: [],
      synthetic,
      via: 'cv_profile',
    });
    if (read.queued) queued++;
  }
  return settle('expanded', queued);
}

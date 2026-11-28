// Builds the evidence module for an app (ADR-002: only apps import this).
import { createHash, randomBytes } from 'node:crypto';
import {
  BudgetExceeded,
  MAP_TO_COMPETENCY_VERSION,
  mapToCompetencyRequest,
  CANDIDATE_PLACEHOLDER,
  compareExcerptsRequest,
  flaggedPairs,
  InvalidCitation,
  SchemaMismatch,
  SourceTooLong,
  UncitedOutput,
  modelOf,
  parseCvRequest,
  type AiClient,
  type Identifiers,
} from '@credalent/ai';
import type { AuditContract } from '@credalent/audit';
import { PermanentFailure, type Handler, type Scheduler } from '@credalent/db/consumer';
import type { Db, Tx } from '@credalent/db';
import { enqueue, newEnvelope, type Envelope, type EventDefinition } from '@credalent/db/outbox';
import { uuidv7 } from '@credalent/db/uuidv7';
import { ApplicationReceivedV1 } from '@credalent/intake';
import { RubricApprovedV1 } from '@credalent/jobs';
import { withWorkspace } from '@credalent/db/with-workspace';
import { FileCleanV1, FileRejectedV1 } from '@credalent/files';
import { annotateSpan, log, withSpan } from '@credalent/observability';
import { budgetResetAt } from './domain/budget.ts';
import { cvParseUseCases, isTransient, parseCv, type CvPorts, type ParsePorts } from './application/cvParse.ts';
import type { WorkspacesContract } from '@credalent/workspaces';
import { documentReadUseCases, readDocument, type ReadPorts } from './application/documentRead.ts';
import { evidenceUseCases, type Ports } from './application/evidence.ts';
import { linkReadUseCases, readLink, type FetchPage, type LinkPorts } from './application/linkRead.ts';
import { MappingBusy, mapEvidence, mappingUseCases, type MappingPorts } from './application/mapping.ts';
import {
  type ApprovedRubricPort,
  GitHubRateLimited,
  queueArrivalReads,
  queueRepositoryRead,
  readRepository,
  refreshStaleRepositorySources,
  repositoryReadUseCases,
  type ArrivalPorts,
  type RepositoryPorts,
} from './application/repositoryRead.ts';
import {
  recordRequestOutcome,
  requestUseCases,
  type OutcomePorts,
  type RequestOutcome,
} from './application/requests.ts';
import {
  ContradictionResolvedV1,
  CvParseRequestedV1,
  DocumentReadRequestedV1,
  EvidenceMappedV1,
  EvidenceMappingRequestedV1,
  EvidenceRecordedV1,
  EvidenceRequestAnsweredV1,
  EvidenceRequestOpenedV1,
  EvidenceRequestQuietV1,
  EvidenceRequestSentV1,
  GitHubProfileExpandRequestedV1,
  LinkReadRequestedV1,
  RepositoryReadRequestedV1,
  RepositoryRefreshRequestedV1,
  type EvidenceContract,
} from './contracts/index.ts';
import { cvParseStore } from './infrastructure/cvParseStore.ts';
import { createDocumentIntelligence, type DocumentIntelligenceConfig } from './infrastructure/documentIntelligence.ts';
import { documentReadStore } from './infrastructure/documentReadStore.ts';
import { createGitHub, type GitHubConfig } from './infrastructure/github.ts';
import { createLinkFetcher } from './infrastructure/linkFetch.ts';
import { linkReadStore } from './infrastructure/linkReadStore.ts';
import { profileExpansionStore } from './infrastructure/profileExpansionStore.ts';
import { mappingStore } from './infrastructure/mappingStore.ts';
import { expandProfile, queueProfileExpansion, type ExpansionQueuePorts } from './application/profileExpansion.ts';
import { evidenceStore } from './infrastructure/repository.ts';
import { repositoryReadStore } from './infrastructure/repositoryReadStore.ts';
import { requestStore } from './infrastructure/requestStore.ts';
import { inbox, outbox } from './infrastructure/schema.ts';

export { createLinkFetcher, type Resolve } from './infrastructure/linkFetch.ts';
// A person's evidence for a duplicate merge (AIV-P1-018); apps wire it into `createCandidates`.
export { createEvidenceRecords } from './infrastructure/mergeRecords.ts';

/** The queue RepositoryReadRequested.v1 and RepositoryRefreshRequested.v1 go to (infra/modules/messaging.bicep). */
export const EVIDENCE_QUEUE = 'evidence';

const publishReadRequested: RepositoryPorts['publishReadRequested'] = (tx, source) =>
  enqueue(tx, outbox, RepositoryReadRequestedV1, {
    workspaceId: source.workspaceId,
    payload: { candidateId: source.candidateId, sourceId: source.id },
    dedupeKey: `repository-read:${source.id}`,
    occurredAt: source.createdAt,
  });

const publishParseRequested: CvPorts['publishParseRequested'] = (tx, source, dedupeKey = `cv-parse:${source.id}`) =>
  enqueue(tx, outbox, CvParseRequestedV1, {
    workspaceId: source.workspaceId,
    payload: { candidateId: source.candidateId, sourceId: source.id },
    dedupeKey,
    occurredAt: source.createdAt,
  });

const publishExpandRequested: ExpansionQueuePorts['publishExpandRequested'] = (tx, expansion, occurredAt) =>
  enqueue(tx, outbox, GitHubProfileExpandRequestedV1, {
    workspaceId: expansion.workspaceId,
    payload: { candidateId: expansion.candidateId, expansionId: expansion.id },
    dedupeKey: `profile-expand:${expansion.id}`,
    occurredAt,
  });

const publishLinkReadRequested: LinkPorts['publishLinkReadRequested'] = (tx, source) =>
  enqueue(tx, outbox, LinkReadRequestedV1, {
    workspaceId: source.workspaceId,
    payload: { candidateId: source.candidateId, sourceId: source.id },
    dedupeKey: `link-read:${source.id}`,
    occurredAt: source.createdAt,
  });

const publishRecorded: Ports['publishRecorded'] = (tx, source, itemIds, dedupeKey = `source:${source.id}`) =>
  enqueue(tx, outbox, EvidenceRecordedV1, {
    workspaceId: source.workspaceId,
    payload: { candidateId: source.candidateId, sourceId: source.id, itemIds },
    dedupeKey,
    occurredAt: source.createdAt,
  });

const publishContradictionResolved: Ports['publishContradictionResolved'] = (
  tx,
  { workspaceId, ...payload },
  occurredAt,
) =>
  enqueue(tx, outbox, ContradictionResolvedV1, {
    workspaceId,
    payload,
    dedupeKey: `contradiction-resolved:${payload.comparisonId}`,
    occurredAt,
  });

const publishMappingRequested: Ports['publishMappingRequested'] = (tx, { workspaceId, ...payload }, occurredAt) =>
  enqueue(tx, outbox, EvidenceMappingRequestedV1, {
    workspaceId,
    payload,
    // Every resolution asks once; a later one must not be dropped as a duplicate.
    dedupeKey: `mapping:resolution:${uuidv7()}`,
    occurredAt,
  });

const logFlagged: Ports['logFlagged'] = ({ similarity, ...ids }) =>
  log.info({ ...ids, 'credalent.evidence.similarity': similarity }, 'evidence near-duplicate flagged');
const sha1: Ports['sha1'] = (input) => createHash('sha1').update(input).digest();

/** The candidate as the system reads it (the candidates module's `readPersonAsSystem`), in the worker's transaction. */
export type ReadPerson = (
  tx: Tx,
  workspaceId: string,
  personId: string,
) => Promise<{ displayName: string; unnamed: boolean; emails: string[]; phones: string[] } | null>;

/**
 * The identifiers `@credalent/ai` replaces in every evidence prompt (ADR-006 point 7, AIV-P1-080), and the name it puts
 * back where model text shown to a recruiter carries the placeholder. No person means no identifiers: the call then
 * fails closed (`MissingIdentifiers`) and the delivery retries.
 */
async function candidateOf(
  readPerson: ReadPerson,
  tx: Tx,
  workspaceId: string,
  candidateId: string,
  /** A name read from the CV, not yet on the record (AIV-P1-090). */
  extraNames: string[] = [],
) {
  const person = await readPerson(tx, workspaceId, candidateId);
  // The intake placeholder is no name: redacting it would hide nothing (AIV-P1-090).
  // shortcut: an unnamed applicant's non-CV sources (links, documents) go out with no name to redact, since none is known
  // until a CV parse finds one; fail closed here if pilot links or documents show names.
  const identifiers: Identifiers | undefined = person
    ? {
        names: [...(person.unnamed ? [] : [person.displayName]), ...extraNames],
        emails: person.emails,
        phones: person.phones,
      }
    : undefined;
  const named = <T>(value: T): T => {
    if (!person) return value;
    if (typeof value === 'string') return value.replaceAll(CANDIDATE_PLACEHOLDER, person.displayName) as T;
    if (Array.isArray(value)) return value.map(named) as T;
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, named(child)])) as T;
    return value;
  };
  return { identifiers, named };
}

/**
 * Every call runs in the request's `withWorkspace` transaction (`ctx.tx`), so no pool is needed here.
 * `now` is the injected clock (AGENTS.md 3.9); tests pass a fixed one.
 */
export function createEvidence(
  workspaces: Pick<WorkspacesContract, 'authorize' | 'getWorkspace'>,
  audit: Pick<AuditContract, 'record'>,
  now: () => Date = () => new Date(),
  // Fails closed: with no resolver a hiring owner or interviewer reads nothing (the intake module's resolver, AIV-P1-091).
  candidateJob: Ports['candidateJob'] = async () => null,
): EvidenceContract {
  const ports: Ports = {
    storeFor: evidenceStore,
    publishRecorded,
    publishContradictionResolved,
    publishMappingRequested,
    candidateJob,
    authorize: (ctx, action, resource) => workspaces.authorize(ctx, action, resource),
    isSyntheticWorkspace: async (ctx) => (await workspaces.getWorkspace(ctx))?.synthetic === true,
    audit: (ctx, entry) =>
      audit.record({ tx: ctx.tx, workspaceId: ctx.workspaceId, actor: { type: 'user', id: ctx.userId } }, entry),
    logFlagged,
    sha1,
    newId: () => uuidv7(),
    now,
  };
  return {
    ...evidenceUseCases(ports),
    ...repositoryReadUseCases({
      ...ports,
      readStoreFor: repositoryReadStore,
      publishReadRequested,
      publishRefreshRequested: (tx, { workspaceId, candidateId, jobId, at }) =>
        enqueue(tx, outbox, RepositoryRefreshRequestedV1, {
          workspaceId,
          payload: { candidateId, jobId },
          // Every request is its own: a refresh is idempotent, and a later one must not be dropped as a duplicate.
          dedupeKey: `repository-refresh:${uuidv7()}`,
          occurredAt: at,
        }),
    }),
    ...mappingUseCases({ ...ports, mappingStoreFor: mappingStore }),
    ...cvParseUseCases({
      ...ports,
      cvStoreFor: cvParseStore,
      mappingStoreFor: mappingStore,
      publishParseRequested,
    }),
    ...documentReadUseCases({
      ...ports,
      cvStoreFor: cvParseStore,
      documentStoreFor: documentReadStore,
      publishReadRequested: (tx, source) =>
        enqueue(tx, outbox, DocumentReadRequestedV1, {
          workspaceId: source.workspaceId,
          payload: { candidateId: source.candidateId, sourceId: source.id },
          dedupeKey: `document-read:${source.id}`,
          occurredAt: source.createdAt,
        }),
    }),
    ...linkReadUseCases({
      ...ports,
      cvStoreFor: cvParseStore,
      linkStoreFor: linkReadStore,
      publishLinkReadRequested,
    }),
    ...requestUseCases({
      ...ports,
      ...outcomePorts(now),
      newToken: () => {
        const token = randomBytes(32).toString('base64url');
        return { token, hash: createHash('sha256').update(token).digest('hex') };
      },
    }),
  };
}

const outcomePorts = (now: () => Date): OutcomePorts => ({
  requestStoreFor: requestStore,
  publishRequestEvent: (tx, request, status) =>
    enqueue(tx, outbox, REQUEST_EVENTS[status], {
      workspaceId: request.workspaceId,
      payload: { requestId: request.id, candidateId: request.candidateId, jobId: request.jobId },
      dedupeKey: `request:${request.id}:${status}`,
      occurredAt: now(),
    }),
});

/**
 * The candidate's evidence for one job as the system reads it, in a worker job's workspace-scoped transaction with no
 * member: what the assessment worker scores (AIV-P1-031). As `listEvidenceForCandidate`: only the job's links, from
 * the candidate's newest mapping run for it.
 */
export const readEvidenceForJobAsSystem = (tx: Tx, workspaceId: string, candidateId: string, jobId: string) =>
  evidenceStore(tx).list(workspaceId, { candidateId }, jobId);

/**
 * Records a request's outcome as the system, in a workspace-scoped transaction with no member: for the follow-up
 * worker (AIV-P1-040) and the portal (AIV-P1-041). It can never send.
 */
export function createRequestOutcomeRecorder(now: () => Date = () => new Date()) {
  const ports = outcomePorts(now);
  return (tx: Tx, workspaceId: string, requestId: string, outcome: RequestOutcome) =>
    recordRequestOutcome(ports, tx, workspaceId, requestId, outcome);
}

const REQUEST_EVENTS = {
  sent: EvidenceRequestSentV1,
  opened: EvidenceRequestOpenedV1,
  answered: EvidenceRequestAnsweredV1,
  quiet: EvidenceRequestQuietV1,
} as const;

/** The same request again on the evidence queue, for just after GitHub's rate limit resets. */
async function reschedule<P>(
  scheduler: Scheduler,
  event: EventDefinition<P>,
  envelope: Envelope,
  payload: P,
  resetAt: Date,
  now: () => Date,
) {
  const next = newEnvelope(event, { workspaceId: envelope.workspaceId, payload, occurredAt: now() });
  await scheduler.schedule(EVIDENCE_QUEUE, next, new Date(resetAt.getTime() + 1000));
  log.info({ 'outbox.event_id': envelope.id }, 'github read rescheduled after its rate limit');
}

/** The same request on the evidence queue after the daily AI budget resets (AIV-P1-089); nothing is marked failed. */
async function rescheduleForBudget<P>(
  scheduler: Scheduler,
  event: EventDefinition<P>,
  workspaceId: string,
  payload: P,
  now: () => Date,
) {
  const at = now();
  // shortcut: every request lands at 00:05 exactly and per-source duplicates are not coalesced; add jitter and a
  // deterministic message id per candidate, job and day if a spent budget fans out many calls.
  await scheduler.schedule(
    EVIDENCE_QUEUE,
    newEnvelope(event, { workspaceId, payload, occurredAt: at }),
    budgetResetAt(at),
  );
  log.info(
    { 'workspace.id': workspaceId, 'event.type': event.type },
    'ai work rescheduled after the daily token budget',
  );
}

/** How long a mapping request waits behind a run in flight for the same candidate and job. */
const MAPPING_BUSY_DELAY_MS = 60_000;

/** An answer a retry cannot fix is dead-lettered on the first delivery (AIV-P1-089). */
const permanent = (error: unknown): error is Error =>
  error instanceof InvalidCitation ||
  error instanceof SchemaMismatch ||
  error instanceof UncitedOutput ||
  error instanceof SourceTooLong;

/**
 * The worker job `evidence.repository.read` on the evidence queue. When GitHub's rate limit is spent, the same request
 * is scheduled on Service Bus for just after `x-ratelimit-reset` and this delivery completes: before anything is
 * written the source simply stays pending; when only the skill-signal file reads were cut short, the read is stored
 * with that coverage gap and the retry reads those files again. No error reaches the recruiter.
 */
export function createRepositoryReadHandler(config: {
  github: GitHubConfig;
  scheduler: Scheduler;
  now?: () => Date;
}): Handler<{ candidateId: string; sourceId: string }> {
  const now = config.now ?? (() => new Date());
  const github = createGitHub({ now, ...config.github });
  return {
    event: RepositoryReadRequestedV1,
    inbox,
    consumer: 'evidence.repository.read',
    async handle(tx, payload, envelope) {
      let retryAt: Date | null;
      try {
        ({ retryAt } = await readRepository(
          { readStoreFor: repositoryReadStore, publishRecorded, newId: uuidv7, now, github },
          tx,
          envelope.workspaceId,
          payload.sourceId,
        ));
      } catch (error) {
        if (!(error instanceof GitHubRateLimited)) throw error;
        retryAt = error.resetAt;
      }
      if (retryAt) await reschedule(config.scheduler, RepositoryReadRequestedV1, envelope, payload, retryAt, now);
    },
  };
}

/**
 * The worker job `evidence.repository.refresh-stale` on the evidence queue (AIV-P1-072): re-reads the candidate's stale
 * repository sources and grades them against the job's approved rubric version, which `approvedRubric` reads (the jobs
 * module's `createApprovedRubricReads`). A rate limit writes nothing and reschedules the request, as the read does.
 */
export function createRepositoryRefreshHandler(config: {
  github: GitHubConfig;
  scheduler: Scheduler;
  approvedRubric: ApprovedRubricPort;
  now?: () => Date;
}): Handler<{ candidateId: string; jobId: string }> {
  const now = config.now ?? (() => new Date());
  const github = createGitHub({ now, ...config.github });
  const ports = {
    readStoreFor: repositoryReadStore,
    publishRecorded,
    newId: uuidv7,
    now,
    github,
    approvedRubric: config.approvedRubric,
  };
  return {
    event: RepositoryRefreshRequestedV1,
    inbox,
    consumer: 'evidence.repository.refresh-stale',
    async handle(tx, payload, envelope) {
      try {
        // A savepoint, so a rate limit midway rolls back every re-read and grade before the request is rescheduled.
        await tx.transaction((sp) =>
          refreshStaleRepositorySources(ports, sp, envelope.workspaceId, payload.candidateId, payload.jobId),
        );
        log.info({ 'outbox.event_id': envelope.id }, 'repository sources refreshed');
      } catch (error) {
        if (!(error instanceof GitHubRateLimited)) throw error;
        await reschedule(config.scheduler, RepositoryRefreshRequestedV1, envelope, payload, error.resetAt, now);
      }
    },
  };
}

/**
 * The worker job `evidence.github.profile-expand` on the evidence queue (AIV-P1-112): lists a CV's GitHub profile and
 * queues an ordinary repository read for its best few own repositories. A rate limit reschedules it for just after the
 * reset and settles nothing. The log line carries ids, the number queued and the outcome: never the login or a name.
 */
export function createProfileExpansionHandler(config: {
  github: GitHubConfig;
  scheduler: Scheduler;
  now?: () => Date;
}): Handler<{ candidateId: string; expansionId: string }> {
  const now = config.now ?? (() => new Date());
  const ports = {
    profileStoreFor: profileExpansionStore,
    github: createGitHub({ now, ...config.github }),
    queueRead: (tx: Tx, workspaceId: string, input: Parameters<typeof queueRepositoryRead>[3]) =>
      queueRepositoryRead(
        { readStoreFor: repositoryReadStore, publishReadRequested, newId: uuidv7, now },
        tx,
        workspaceId,
        input,
      ),
  };
  return {
    event: GitHubProfileExpandRequestedV1,
    inbox,
    consumer: 'evidence.github.profile-expand',
    async handle(tx, payload, envelope) {
      try {
        const result = await expandProfile(ports, tx, envelope.workspaceId, payload.expansionId);
        if (result)
          log.info(
            {
              'evidence.expansion_id': payload.expansionId,
              'evidence.candidate_id': result.candidateId,
              'credalent.evidence.profile_queued': result.queued,
              'credalent.evidence.profile_outcome': result.status,
            },
            'github profile expanded',
          );
      } catch (error) {
        if (!(error instanceof GitHubRateLimited)) throw error;
        await reschedule(config.scheduler, GitHubProfileExpandRequestedV1, envelope, payload, error.resetAt, now);
      }
    },
  };
}

const QUEUED_MESSAGES = {
  repository: ['repository read queued', 'repository read already queued'],
  cv: ['cv parse queued', 'cv parse already queued'],
  link: ['link read queued', 'link read already queued'],
} as const;

/**
 * The worker job `evidence.application.received` on the evidence queue: queues one read per GitHub repository link an
 * arrival or a member's link brings (AIV-P1-076), one link read per other link (AIV-P1-077) and one parse per CV file
 * it carries (AIV-P1-079), as the system in
 * the envelope's workspace. The intake, candidates and files reads come from the worker's composition root, so this
 * module imports none of their internals.
 */
export function createApplicationReceivedHandler(
  config: Pick<ArrivalPorts, 'readArrival' | 'readPerson' | 'readFilePurpose'> & { now?: () => Date },
): Handler<{ applicationId: string; sourceId: string }> {
  const ports: ArrivalPorts = {
    ...config,
    readStoreFor: repositoryReadStore,
    publishReadRequested,
    cvStoreFor: cvParseStore,
    publishParseRequested,
    linkStoreFor: linkReadStore,
    publishLinkReadRequested,
    newId: uuidv7,
    now: config.now ?? (() => new Date()),
    logRefused: (ids) => log.warn(ids, 'batch not confirmed'),
    logQueued: (kind, { queued, ...ids }) => log.info(ids, QUEUED_MESSAGES[kind][queued ? 0 : 1]),
  };
  return {
    event: ApplicationReceivedV1,
    inbox,
    consumer: 'evidence.application.received',
    handle: (tx, payload, envelope) => queueArrivalReads(ports, tx, envelope.workspaceId, payload.sourceId),
  };
}

/** Who applied to what, read in the worker's transaction (the intake module's `createApplicationReads`). */
export type ApplicationsPort = {
  jobsForCandidate(tx: Tx, workspaceId: string, candidateId: string): Promise<string[]>;
  candidatesForJob(tx: Tx, workspaceId: string, jobId: string): Promise<string[]>;
};

/**
 * The evidence mapping jobs on the evidence queue (AIV-P1-027): `EvidenceRecorded.v1` and `RubricApproved.v1` fan out
 * to one `EvidenceMappingRequested.v1` per candidate and job, and `evidence.mapping` maps each through `ai` against
 * the job's approved rubric version (`approvedRubric`, the jobs module's `createApprovedRubricReads`). A model failure
 * throws, so the consumer retries with back-off (AIV-P0-015) while the profile shows the assessment as in progress; an
 * answer no retry can fix, or the last delivery, records the failure for "Could not assess" (AIV-P1-165).
 */
export function createEvidenceMappingHandlers(config: {
  /** The consumers' database: a mapping that fails for good is recorded in its own transaction (AIV-P1-165). */
  db: Db;
  ai: AiClient;
  approvedRubric: MappingPorts['approvedRubric'];
  applications: ApplicationsPort;
  readPerson: ReadPerson;
  scheduler: Scheduler;
  now?: () => Date;
}): Handler<unknown>[] {
  const now = config.now ?? (() => new Date());
  // shortcut: every EvidenceRecorded.v1 (a repository read emits one per source it records) maps each of the
  // candidate's jobs again, one model call each; coalesce per candidate and job if pilot token use or queue depth shows it.
  const requestMapping = (tx: Tx, envelope: Envelope, candidateId: string, jobId: string) =>
    enqueue(tx, outbox, EvidenceMappingRequestedV1, {
      workspaceId: envelope.workspaceId,
      payload: { candidateId, jobId },
      dedupeKey: `mapping:${envelope.id}:${candidateId}:${jobId}`,
      occurredAt: now(),
    });
  // Per candidate: both prompts send the candidate's sources, so both carry the candidate's identifiers.
  const portsFor = ({ identifiers, named }: Awaited<ReturnType<typeof candidateOf>>): MappingPorts => ({
    storeFor: evidenceStore,
    readStoreFor: repositoryReadStore,
    mappingStoreFor: mappingStore,
    approvedRubric: config.approvedRubric,
    mapToCompetencies: async (workspaceId, competencies, sources) => {
      let uncited = 0;
      const { links, changes } = await config.ai.generateStructured({
        ...mapToCompetencyRequest(competencies, sources),
        workspaceId,
        identifiers,
        onDropped: (count) => (uncited = count),
      });
      // Quotes come back as the stored text; a limit or a check the model wrote may carry the placeholder.
      return { ...named({ links, changes }), uncited };
    },
    compareExcerpts: async (workspaceId, sources, pairs) => {
      try {
        const answer = await config.ai.generateStructured({
          ...compareExcerptsRequest(sources, pairs),
          workspaceId,
          identifiers,
        });
        return flaggedPairs(answer, pairs);
      } catch (error) {
        // A rejected answer stores no contradiction and is counted (logMapped); an outage still throws and retries.
        if (
          error instanceof InvalidCitation ||
          error instanceof SchemaMismatch ||
          error instanceof UncitedOutput ||
          error instanceof SourceTooLong
        )
          return null;
        throw error;
      }
    },
    promptVersion: MAP_TO_COMPETENCY_VERSION,
    model: modelOf('evidence.mapToCompetency'),
    publishMapped: (tx, run) =>
      enqueue(tx, outbox, EvidenceMappedV1, {
        workspaceId: run.workspaceId,
        payload: {
          candidateId: run.candidateId,
          jobId: run.jobId,
          rubricVersionId: run.rubricVersionId,
          mappingId: run.id,
        },
        dedupeKey: `mapped:${run.id}`,
        occurredAt: run.createdAt,
      }),
    logMapped: ({ discarded, compared, ...counts }) =>
      log.info(
        {
          'credalent.evidence.mapping_id': counts.mappingId,
          'credalent.evidence.links': counts.links,
          'credalent.evidence.gaps': counts.gaps,
          'credalent.evidence.contradictions': counts.contradictions,
          'credalent.evidence.uncited_changes': counts.uncitedChanges,
          'credalent.evidence.uncited_links': counts.uncitedLinks,
          'credalent.evidence.too_long': counts.tooLong,
          'credalent.evidence.compared.sent': compared.sent,
          'credalent.evidence.compared.flagged': compared.flagged,
          'credalent.evidence.compared.rejected': compared.rejected,
          ...Object.fromEntries(Object.entries(discarded).map(([k, v]) => [`credalent.evidence.discarded.${k}`, v])),
        },
        'evidence mapped',
      ),
    newId: uuidv7,
    now,
  });
  return [
    {
      event: EvidenceRecordedV1,
      inbox,
      consumer: 'evidence.mapping.recorded',
      async handle(tx, { candidateId }, envelope) {
        for (const jobId of await config.applications.jobsForCandidate(tx, envelope.workspaceId, candidateId))
          await requestMapping(tx, envelope, candidateId, jobId);
      },
    } satisfies Handler<{ candidateId: string; sourceId: string; itemIds: string[] }>,
    {
      event: RubricApprovedV1,
      inbox,
      consumer: 'evidence.mapping.rubric-approved',
      async handle(tx, { jobId }, envelope) {
        for (const candidateId of await config.applications.candidatesForJob(tx, envelope.workspaceId, jobId))
          await requestMapping(tx, envelope, candidateId, jobId);
      },
    } satisfies Handler<{ jobId: string; rubricVersionId: string; supersededVersionId: string | null }>,
    {
      event: EvidenceMappingRequestedV1,
      inbox,
      consumer: 'evidence.mapping',
      async handle(tx, { candidateId, jobId }, envelope, delivery) {
        const candidate = await candidateOf(config.readPerson, tx, envelope.workspaceId, candidateId);
        let run;
        try {
          run = await mapEvidence(portsFor(candidate), tx, envelope.workspaceId, candidateId, jobId);
        } catch (error) {
          if (error instanceof MappingBusy) {
            // shortcut: busy requests are not coalesced, so each makes its own model call in turn; dedupe per candidate
            // and job if pilot fan-out shows it.
            // Not a retry: the delivery budget would dead-letter the newest run behind a long model call.
            await config.scheduler.schedule(
              EVIDENCE_QUEUE,
              newEnvelope(EvidenceMappingRequestedV1, {
                workspaceId: envelope.workspaceId,
                payload: { candidateId, jobId },
                occurredAt: now(),
              }),
              new Date(now().getTime() + MAPPING_BUSY_DELAY_MS),
            );
            log.info({ 'outbox.event_id': envelope.id }, 'evidence mapping rescheduled behind a run in flight');
            return;
          }
          if (error instanceof BudgetExceeded)
            return rescheduleForBudget(
              config.scheduler,
              EvidenceMappingRequestedV1,
              envelope.workspaceId,
              { candidateId, jobId },
              now,
            );
          // Dead-lettered now or on this last delivery: "Could not assess" with "Try again", written in its own
          // transaction since this one rolls back (AIV-P1-165). It holds no lock the delivery holds: a run that maps
          // deletes the row as its last write, after which nothing in mapEvidence can throw.
          if (permanent(error) || (delivery?.last ?? true))
            await withWorkspace(config.db, envelope.workspaceId, (own) =>
              mappingStore(own).fail(envelope.workspaceId, candidateId, jobId, now()),
            );
          if (permanent(error)) throw new PermanentFailure(error.name);
          throw error;
        }
        if (!run) log.info({ 'outbox.event_id': envelope.id }, 'evidence not mapped: the job has no approved rubric');
      },
    } satisfies Handler<{ candidateId: string; jobId: string }>,
  ];
}

/**
 * Runs one read in its span. A transient failure on the last delivery is written as `failed` in its own transaction,
 * since the delivery's rolls back on the rethrow; before that the read stays pending ("Reading the CV…", no retry
 * offered, AIV-P1-134) while the consumer backs off and redelivers, and the last delivery dead-letters.
 */
const tracedRead =
  (db: Db) =>
  (
    name: string,
    workspaceId: string,
    sourceId: string,
    run: () => Promise<{ notes: number } | null>,
    fail: (own: Tx) => Promise<unknown>,
    last: boolean,
  ) =>
    withSpan(name, async () => {
      let result: { notes: number } | null;
      try {
        result = await run();
      } catch (error) {
        if (!isTransient(error)) throw error;
        if (!last) {
          log.warn(
            { 'evidence.source_id': sourceId, 'error.type': (error as Error).name },
            `${name} failed, will retry`,
          );
          throw error;
        }
        // The transient failure comes before the read's row is written, so this never waits on the delivery's locks.
        // shortcut: a second pooled connection while the delivery holds one. Four receivers share the worker's pool of 10
        // (up to 16 deliveries), but only the evidence receiver's take a second connection (this write, the AI budget):
        // 4 x 2 = 8. The sheet import's CV fetches, which also commit while their delivery holds one, have their own pool
        // (apps/backend/worker main.ts). Give any other receiver that takes a second connection a pool of its own too.
        await withWorkspace(db, workspaceId, fail);
        log.warn({ 'evidence.source_id': sourceId, 'error.type': (error as Error).name }, `${name} failed`);
        throw error;
      }
      // SAFETY: the count only; a note's reason and excerpt quote the source and stay in the database (AGENTS.md 1.2).
      if (result) annotateSpan({ 'credalent.evidence.unusual_count': result.notes });
    });

/**
 * The worker jobs that read uploaded files, on the evidence queue: `evidence.cv.parse` (CvParseRequested.v1),
 * `evidence.document.read` (DocumentReadRequested.v1, AIV-P1-028), and on FileClean.v1 the CV parses and document reads
 * that were waiting for that file's malware scan; FileRejected.v1 marks them unreadable. Each span carries the number of
 * "Unusual content in this source" notes and nothing else (AGENTS.md 1.2).
 */
export function createFileReadHandlers(config: {
  /** The consumers' database: a transient failure is recorded in its own transaction before the delivery retries. */
  db: Db;
  documentIntelligence: DocumentIntelligenceConfig;
  ai: Pick<AiClient, 'generateStructured'>;
  readCleanFile: ParsePorts['readCleanFile'];
  recordContact: ParsePorts['recordContact'];
  readPerson: ReadPerson;
  /** The candidates module's `nameUnnamedPerson`: false when the person already has a name. */
  namePerson(tx: Tx, workspaceId: string, personId: string, name: string): Promise<boolean>;
  audit: Pick<AuditContract, 'record'>;
  /** A parse that hits the daily AI budget is scheduled for 00:05 UTC the next day. */
  scheduler: Scheduler;
  now?: () => Date;
}): Handler<unknown>[] {
  const now = config.now ?? (() => new Date());
  const ports: ParsePorts & ReadPorts = {
    storeFor: evidenceStore,
    cvStoreFor: cvParseStore,
    documentStoreFor: documentReadStore,
    publishRecorded,
    readCleanFile: config.readCleanFile,
    recordContact: config.recordContact,
    queueRead: (tx, workspaceId, input) =>
      queueRepositoryRead(
        { readStoreFor: repositoryReadStore, publishReadRequested, newId: uuidv7, now },
        tx,
        workspaceId,
        input,
      ),
    queueProfile: (tx, workspaceId, input) =>
      queueProfileExpansion(
        { profileStoreFor: profileExpansionStore, publishExpandRequested, newId: uuidv7, now },
        tx,
        workspaceId,
        input,
      ),
    documentIntelligence: createDocumentIntelligence(config.documentIntelligence),
    // Every stored CV claim is a slice of the CV text at its citation's offsets, so no placeholder reaches a recruiter.
    extract: async (tx, workspaceId, candidateId, sourceId, text, names) =>
      config.ai.generateStructured({
        ...parseCvRequest([{ id: sourceId, kind: 'cv', text }]),
        workspaceId,
        identifiers: (await candidateOf(config.readPerson, tx, workspaceId, candidateId, names)).identifiers,
      }),
    readPerson: async (tx, workspaceId, candidateId) => {
      const person = await config.readPerson(tx, workspaceId, candidateId);
      return person && { unnamed: person.unnamed };
    },
    nameApplicant: async (tx, workspaceId, candidateId, name) => {
      if (!(await config.namePerson(tx, workspaceId, candidateId, name))) return;
      await config.audit.record(
        { tx, workspaceId, actor: { type: 'system' } },
        { action: 'candidate.renamed', subject: { type: 'candidate', id: candidateId }, note: 'Named from the CV' },
      );
    },
    logFlagged,
    sha1,
    newId: uuidv7,
    now,
  };
  const traced = tracedRead(config.db);
  // `last` defaults to true: a direct call outside the consumer is its own last delivery.
  const parse = (tx: Tx, workspaceId: string, sourceId: string, last = true) =>
    traced(
      'evidence cv parse',
      workspaceId,
      sourceId,
      async () => {
        const result = await parseCv(ports, tx, workspaceId, sourceId);
        if (result?.status === 'waiting') {
          const found = await cvParseStore(tx).find(workspaceId, sourceId);
          if (found)
            await rescheduleForBudget(
              config.scheduler,
              CvParseRequestedV1,
              workspaceId,
              { candidateId: found.source.candidateId, sourceId },
              now,
            );
        }
        return result;
      },
      (own) => cvParseStore(own).finish(workspaceId, sourceId, 'failed'),
      last,
    );
  const read = (tx: Tx, workspaceId: string, sourceId: string, last = true) =>
    traced(
      'evidence document read',
      workspaceId,
      sourceId,
      () => readDocument(ports, tx, workspaceId, sourceId),
      (own) => documentReadStore(own).finish(workspaceId, sourceId, 'failed'),
      last,
    );
  const cvRequested: Handler<{ candidateId: string; sourceId: string }> = {
    event: CvParseRequestedV1,
    inbox,
    consumer: 'evidence.cv.parse',
    handle: (tx, payload, envelope, delivery) => parse(tx, envelope.workspaceId, payload.sourceId, delivery?.last),
  };
  const documentRequested: Handler<{ candidateId: string; sourceId: string }> = {
    event: DocumentReadRequestedV1,
    inbox,
    consumer: 'evidence.document.read',
    handle: (tx, payload, envelope, delivery) => read(tx, envelope.workspaceId, payload.sourceId, delivery?.last),
  };
  const clean: Handler<{ fileId: string }> = {
    event: FileCleanV1,
    inbox,
    consumer: 'evidence.file_clean',
    async handle(tx, payload, envelope, delivery) {
      const { workspaceId } = envelope;
      for (const sourceId of await cvParseStore(tx).pendingForFile(workspaceId, payload.fileId))
        await parse(tx, workspaceId, sourceId, delivery?.last);
      for (const sourceId of await documentReadStore(tx).pendingForFile(workspaceId, payload.fileId))
        await read(tx, workspaceId, sourceId, delivery?.last);
    },
  };
  const rejected: Handler<{ fileId: string; reason: 'infected' | 'rejected' }> = {
    event: FileRejectedV1,
    inbox,
    consumer: 'evidence.file_rejected',
    async handle(tx, payload, envelope) {
      const { workspaceId } = envelope;
      const cvs = cvParseStore(tx);
      for (const sourceId of await cvs.pendingForFile(workspaceId, payload.fileId))
        await cvs.finish(workspaceId, sourceId, 'unreadable');
      const documents = documentReadStore(tx);
      for (const sourceId of await documents.pendingForFile(workspaceId, payload.fileId))
        await documents.finish(workspaceId, sourceId, 'unreadable');
    },
  };
  return [cvRequested, documentRequested, clean, rejected] as Handler<unknown>[];
}

/**
 * The worker job `evidence.link.read` on the evidence queue (AIV-P1-077): fetches a shipped-product or write-up link
 * behind the SSRF guard (`fetchPage`, by default `createLinkFetcher()`), stores the page as one Candidate-submitted
 * item. The span carries the number of "Unusual content in this source" notes and nothing else: no URL, host, title or
 * page text (AGENTS.md 1.2). Nothing here is transient (an unreachable link is `not_reachable`), so a failure rolls the
 * delivery back and the consumer retries it.
 */
export function createLinkReadHandler(config: {
  fetchPage?: FetchPage;
  now?: () => Date;
}): Handler<{ candidateId: string; sourceId: string }> {
  const ports = {
    storeFor: evidenceStore,
    cvStoreFor: cvParseStore,
    linkStoreFor: linkReadStore,
    publishRecorded,
    fetchPage: config.fetchPage ?? createLinkFetcher(),
    logFlagged,
    sha1,
    newId: uuidv7,
    now: config.now ?? (() => new Date()),
  };
  return {
    event: LinkReadRequestedV1,
    inbox,
    consumer: 'evidence.link.read',
    handle: (tx, { sourceId }, { workspaceId }) =>
      withSpan('evidence link read', async () => {
        const result = await readLink(ports, tx, workspaceId, sourceId);
        // SAFETY: the count only, as for file reads (AGENTS.md 1.2).
        if (result) annotateSpan({ 'credalent.evidence.unusual_count': result.notes });
      }),
  };
}

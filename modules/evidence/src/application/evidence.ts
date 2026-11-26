import type { Tx } from '@credalent/db';
import type { NewEntry } from '@credalent/audit';
import type { Action, JobResource, WorkspaceContext } from '@credalent/workspaces';
import {
  checkItem,
  checkItems,
  checkLink,
  checkSource,
  EvidenceError,
  REFERENCE_ROLES,
  type CompetencyLink,
  type EvidenceItem,
  type EvidenceSource,
  type ReferenceRole,
} from '../domain/evidence.ts';
import type { Comparison, Resolution } from '../domain/corroboration.ts';
import type { RepositoryVia } from '../domain/repository.ts';
import {
  crossApplicantMatches,
  DUPLICATE_RESOLUTIONS,
  fingerprintText,
  groupOrigins,
  type DuplicateFlag,
  type DuplicateResolution,
  type FingerprintedSource,
  type Sha1,
} from '../domain/fingerprint.ts';

/**
 * An item with its source and the links to the asked job's competencies. `via` is how a repository read came about
 * (AIV-P1-112): provenance for the source chip (AIV-P1-118), never read by assessment or ranking.
 */
export type EvidenceItemView = EvidenceItem & {
  source: EvidenceSource & { via: RepositoryVia | null };
  competencies: CompetencyLink[];
};

/** The store over one workspace-scoped transaction. Every method filters by `workspaceId`. */
export type EvidenceStore = {
  insert(source: EvidenceSource, items: EvidenceItem[], links: (CompetencyLink & { itemId: string })[]): Promise<void>;
  /**
   * The link's level before (null when new), or null when the workspace has no such item. Linking twice keeps one link,
   * at the latest level.
   */
  link(workspaceId: string, itemId: string, link: CompetencyLink): Promise<{ level: number | null } | null>;
  /**
   * The candidate's items, oldest first; `jobId` set narrows `competencies` to that job's and leaves out items of any
   * mapping run but the candidate's newest for the job; null keeps every link. `unmapped` keeps only recorded items.
   */
  list(
    workspaceId: string,
    filter: { candidateId?: string; itemId?: string; unmapped?: boolean },
    jobId: string | null,
  ): Promise<EvidenceItemView[]>;
  /**
   * One candidate's sources with their fingerprints, or with no candidate every fingerprinted source; oldest first.
   * With no candidate it first takes the workspace's comparison lock, held until commit.
   */
  fingerprints(workspaceId: string, candidateId?: string): Promise<FingerprintedSource[]>;
  insertFlags(flags: DuplicateFlag[]): Promise<void>;
  /** Flags on either side of which the candidate stands, oldest first. */
  flags(workspaceId: string, candidateId: string): Promise<DuplicateFlag[]>;
  /** Sets the resolution and returns the flag as it was before, or null when the workspace has no such flag. */
  resolveFlag(
    workspaceId: string,
    flagId: string,
    resolution: Pick<DuplicateFlag, 'resolution' | 'resolvedBy' | 'resolvedAt'>,
  ): Promise<DuplicateFlag | null>;
  /**
   * Resolves an open or resolved contradiction (never an agreement), letting `standingItemId`'s source stand (null:
   * both), and returns it as it was before, or null when the workspace has no such contradiction. Throws
   * `EvidenceError('standing')` when the standing item is not one of the pair's.
   */
  resolveComparison(
    workspaceId: string,
    comparisonId: string,
    resolution: Omit<Resolution, 'resolutionStandingSourceId'>,
    standingItemId: string | null,
  ): Promise<(Comparison & { rubricVersionId: string }) | null>;
  /** The comparisons of the candidate's newest mapping run for the job, oldest first. */
  comparisons(workspaceId: string, candidateId: string, jobId: string): Promise<Comparison[]>;
  /** Deletes all the workspace's evidence; false, with nothing deleted, if any source is not synthetic. */
  deleteSynthetic(workspaceId: string): Promise<boolean>;
};

/** The job the candidate applied to as the context may see it, or null (the intake module's `createCandidateJobResolver`). */
export type CandidateJob = (ctx: WorkspaceContext, candidateId: string, jobId: string) => Promise<JobResource | null>;

export type Ports = {
  storeFor(tx: Tx): EvidenceStore;
  /**
   * Resolves a job-named read's job from the candidate's stored application, so a hiring owner or interviewer is
   * authorised against the record's job and the agency client's grant, never the request's job id (AIV-P1-091).
   */
  candidateJob: CandidateJob;
  /** Writes `EvidenceRecorded.v1` to the outbox in `tx`, so it commits only with the evidence. */
  /** `dedupeKey` defaults to the source id; a re-read of the source passes its own. */
  publishRecorded(tx: Tx, source: EvidenceSource, itemIds: string[], dedupeKey?: string): Promise<void>;
  /** Asks the assessment queue to score the comparison's candidate for its job again (AIV-P1-098). */
  publishContradictionResolved(
    tx: Tx,
    resolved: {
      workspaceId: string;
      candidateId: string;
      jobId: string;
      rubricVersionId: string;
      comparisonId: string;
    },
    occurredAt: Date,
  ): Promise<void>;
  /**
   * Asks the worker to map the candidate's evidence for the job again (`EvidenceMappingRequested.v1`): after a
   * resolution sets a source aside, what that source vouched for is settled again without it (AIV-P2-063).
   */
  publishMappingRequested(
    tx: Tx,
    request: { workspaceId: string; candidateId: string; jobId: string },
    occurredAt: Date,
  ): Promise<void>;
  /** Job-scoped roles also need a grant on `resource` (ADR-005 point 6). */
  authorize(ctx: WorkspaceContext, action: Action, resource?: JobResource): Promise<void>;
  isSyntheticWorkspace(ctx: WorkspaceContext): Promise<boolean>;
  /** Appends an audit entry in `ctx.tx`; the last statement before commit (AGENTS.md 3.6). */
  audit(ctx: WorkspaceContext, entry: NewEntry): Promise<void>;
  /** Logs a raised flag: source ids and the similarity only, never text, names or fingerprints (AGENTS.md 1.2). */
  logFlagged(fields: { flagId: string; sourceId: string; otherSourceId: string; similarity: number }): void;
  sha1: Sha1;
  newId(): string;
  now(): Date;
};

/** One source and the items it backs. Its caller (an importer, a server action) validates the shape with zod. */
export type RecordEvidenceInput = {
  candidateId: string;
  source: Pick<EvidenceSource, 'kind' | 'label' | 'url' | 'blobFileId' | 'capturedAt' | 'checkedAt' | 'checkMethod'>;
  items: (Pick<EvidenceItem, 'excerpt' | 'excerptSpan' | 'provenance' | 'strength' | 'limit'> & {
    competencies?: CompetencyLink[];
  })[];
  /** Required, so no seed or import can forget it (AGENTS.md 1.1); every item takes the source's. */
  synthetic: boolean;
  /**
   * The source's full prose text when its importer has it (a write-up, a document), used only to compute its
   * fingerprint (AIV-P1-071) and never stored here: the text stays where it already is (database or Blob).
   */
  text?: string;
};

export type RecordEvidenceResult = { sourceId: string; itemIds: string[] };

/**
 * "Also submitted by another applicant": flags each other candidate's near-duplicate source in this workspace. The
 * store filters by workspace and row-level security hides every other workspace's sources (ADR-005), so a flag never
 * crosses workspaces. It records the flag and nothing else. Also run by the document read (AIV-P1-028).
 */
// shortcut: compares against every fingerprinted source in the workspace in memory; index fingerprint bands when a
// workspace holds tens of thousands of sources.
export async function flagCrossApplicantCopies(
  { storeFor, newId, logFlagged }: Pick<Ports, 'storeFor' | 'newId' | 'logFlagged'>,
  tx: Tx,
  source: EvidenceSource,
) {
  if (!source.textFingerprint) return;
  const store = storeFor(tx);
  const others = (await store.fingerprints(source.workspaceId)).filter((o) => o.id !== source.id);
  const flags = crossApplicantMatches(source, others).map((match): DuplicateFlag => ({
    id: newId(),
    workspaceId: source.workspaceId,
    sourceId: source.id,
    candidateId: source.candidateId,
    otherSourceId: match.id,
    otherCandidateId: match.candidateId,
    similarity: match.similarity,
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: source.createdAt,
  }));
  if (!flags.length) return;
  await store.insertFlags(flags);
  // Logged before commit: a rolled-back record leaves a line with ids only, never a flag.
  for (const f of flags)
    logFlagged({ flagId: f.id, sourceId: f.sourceId, otherSourceId: f.otherSourceId, similarity: f.similarity });
}

/** A recruiter's notes of a reference call: who was called by role only, never a name or contact (AGENTS.md 1.2). */
export type RecordReferenceCallInput = {
  candidateId: string;
  /** The day of the call, YYYY-MM-DD. */
  calledOn: string;
  calledRole: ReferenceRole;
  /** What the reference said, as the recruiter wrote it down. */
  notes: string;
  synthetic: boolean;
};

export const REFERENCE_LIMIT = "One person's account, noted by the recruiter; it does not show the work itself.";

/** What a person confirmed from an interviewer's meeting summary (AIV-P1-115): one item per changed competency. */
export type RecordInterviewSummaryInput = {
  candidateId: string;
  /** The interview's job: the items are linked to its competencies, and the member is authorised on it. */
  jobId: string;
  /** When the summary was written; the source is labelled by its day. */
  writtenAt: Date;
  items: {
    competencyId: string;
    /** The summary's exact words the change cites. */
    excerpt: string;
    /** Medium at most: Strong means checked by a second source, which one interviewer's word is not. */
    strength: 'medium' | 'claim';
    level: number;
  }[];
  synthetic: boolean;
};

export const INTERVIEW_SUMMARY_LIMIT = "The interviewer's summary of the interview: their word, not inspected work.";

// shortcut: recording and linking are open to admins and recruiters (`candidate.create`). Hiring owners and
// interviewers read through a job: `listEvidenceForCandidate`, `listComparisons` and `getEvidenceMapping` authorise
// against the candidate's application on it (AIV-P1-091); the reads with no job (`getEvidenceItem`, origin groups,
// duplicate flags) stay admins and recruiters until a screen needs them for a job.
export function evidenceUseCases({
  storeFor,
  publishRecorded,
  publishContradictionResolved,
  publishMappingRequested,
  candidateJob,
  authorize,
  isSyntheticWorkspace,
  audit,
  logFlagged,
  sha1,
  newId,
  now,
}: Ports) {
  /** Stores a source and its items; the caller has authorised. */
  async function record(ctx: WorkspaceContext, input: RecordEvidenceInput): Promise<RecordEvidenceResult> {
    checkSource(input.source);
    checkItems(input.items);
    input.items.forEach(checkItem);
    input.items.forEach((i) => i.competencies?.forEach(checkLink));
    const createdAt = now();
    const base = {
      workspaceId: ctx.workspaceId,
      candidateId: input.candidateId,
      synthetic: input.synthetic,
      createdAt,
    };
    const source: EvidenceSource = {
      ...input.source,
      ...base,
      id: newId(),
      label: input.source.label.trim(),
      textFingerprint: input.text === undefined ? null : fingerprintText(input.text, sha1),
    };
    const items = input.items.map(({ competencies = [], ...item }) => ({
      item: { ...item, ...base, id: newId(), sourceId: source.id } satisfies EvidenceItem,
      competencies,
    }));
    await storeFor(ctx.tx).insert(
      source,
      items.map((i) => i.item),
      items.flatMap((i) => i.competencies.map((c) => ({ ...c, itemId: i.item.id }))),
    );
    const itemIds = items.map((i) => i.item.id);
    await publishRecorded(ctx.tx, source, itemIds);
    await flagCrossApplicantCopies({ storeFor, newId, logFlagged }, ctx.tx, source);
    return { sourceId: source.id, itemIds };
  }

  return {
    async recordEvidence(ctx: WorkspaceContext, input: RecordEvidenceInput): Promise<RecordEvidenceResult> {
      await authorize(ctx, 'candidate.create');
      return record(ctx, input);
    },

    /**
     * A reference call as a `reference_call` source ("Reference call, 11 Nov") with one Supporting item, the notes.
     * Admins and recruiters only. The notes are fingerprinted, so notes copied from the candidate's own write-up are
     * one origin with it and never corroborate it (AIV-P1-029).
     */
    async recordReferenceCall(ctx: WorkspaceContext, input: RecordReferenceCallInput): Promise<RecordEvidenceResult> {
      await authorize(ctx, 'candidate.create');
      if (!REFERENCE_ROLES.includes(input.calledRole)) throw new EvidenceError('reference_role');
      const day = /^\d{4}-\d{2}-\d{2}$/u.test(input.calledOn) ? new Date(`${input.calledOn}T00:00:00Z`) : null;
      // A real past or present day: 2026-02-31 would roll over to 3 March.
      if (!day || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== input.calledOn || day > now())
        throw new EvidenceError('called_on');
      const date = day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
      return record(ctx, {
        candidateId: input.candidateId,
        source: {
          kind: 'reference_call',
          label: `Reference call, ${date}`,
          url: null,
          blobFileId: null,
          capturedAt: day,
          checkedAt: day,
          checkMethod: `Reference call (${input.calledRole.replaceAll('_', ' ')})`,
        },
        items: [
          {
            excerpt: input.notes.trim(),
            excerptSpan: null,
            provenance: 'submitted',
            strength: 'supporting',
            limit: REFERENCE_LIMIT,
          },
        ],
        synthetic: input.synthetic,
        text: input.notes,
      });
    },

    /**
     * An interviewer's meeting summary as an `interview_note` source ("Interviewer's summary, 24 Nov") with one item
     * per confirmed change, each citing its excerpt (AIV-P1-115). Anyone who may submit a scorecard on the job.
     */
    // shortcut: a Medium item counts in the score by itself, beside the assessment's own interview change, and is stored
    // `submitted` (the closed provenance list has no "interviewer's word"; the profile and scorecard show it as
    // "Interviewer's word" by its source kind), so a later rating of the same interview that takes the change back
    // leaves this item counting, and the day in the label is UTC. Cite the stored interview change on the profile
    // instead when the assessment offers that read (AIV-P2-006, #120).
    async recordInterviewSummary(
      ctx: WorkspaceContext,
      input: RecordInterviewSummaryInput,
    ): Promise<RecordEvidenceResult> {
      await authorize(ctx, 'scorecard.submit', (await candidateJob(ctx, input.candidateId, input.jobId)) ?? undefined);
      // SAFETY: the interviewer's word is Medium at most and never "Independently corroborated" (AGENTS.md 1.6): the
      // caller names no provenance, and any strength but these two is refused.
      if (input.items.some((i) => i.strength !== 'medium' && i.strength !== 'claim'))
        throw new EvidenceError('strength');
      const date = input.writtenAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
      return record(ctx, {
        candidateId: input.candidateId,
        source: {
          kind: 'interview_note',
          label: `Interviewer's summary, ${date}`,
          url: null,
          blobFileId: null,
          capturedAt: input.writtenAt,
          checkedAt: null,
          checkMethod: null,
        },
        items: input.items.map((i) => ({
          excerpt: i.excerpt,
          excerptSpan: null,
          provenance: i.strength === 'claim' ? 'claim' : 'submitted',
          strength: i.strength,
          limit: INTERVIEW_SUMMARY_LIMIT,
          competencies: [{ jobId: input.jobId, competencyId: i.competencyId, level: i.level }],
        })),
        synthetic: input.synthetic,
      });
    },

    /**
     * A person resolves a contradiction: which item stands (null: both), a note and the limit the items then state; a
     * standing item counts again, the other stays "Contradictory". Audited (`evidence.contradiction_resolved`: actor,
     * time, note, the standing item) as the last statement. Admins and recruiters.
     */
    async resolveContradiction(
      ctx: WorkspaceContext,
      comparisonId: string,
      input: { note: string; limit: string; standingItemId: string | null },
    ): Promise<void> {
      await authorize(ctx, 'candidate.create');
      const note = input.note.trim();
      const limit = input.limit.trim();
      if (!note) throw new EvidenceError('resolution_note');
      if (!limit) throw new EvidenceError('limit');
      const before = await storeFor(ctx.tx).resolveComparison(
        ctx.workspaceId,
        comparisonId,
        { resolvedBy: ctx.userId, resolvedAt: now(), resolutionNote: note, resolutionLimit: limit },
        input.standingItemId,
      );
      if (!before) throw new EvidenceError('comparison_not_found');
      await publishContradictionResolved(
        ctx.tx,
        {
          workspaceId: ctx.workspaceId,
          candidateId: before.candidateId,
          jobId: before.jobId,
          rubricVersionId: before.rubricVersionId,
          comparisonId,
        },
        now(),
      );
      // SAFETY: links were stored as they settle with every resolved source counting; when a source is set aside, or
      // counts again, map again so what it vouches for is settled anew.
      // shortcut: until that run, a link corroborated only by the set-aside source still shows as corroborated; settle it
      // here, without the model, if pilot re-maps lag.
      if (input.standingItemId !== null || before.resolutionStandingSourceId !== null)
        await publishMappingRequested(
          ctx.tx,
          { workspaceId: ctx.workspaceId, candidateId: before.candidateId, jobId: before.jobId },
          now(),
        );
      await audit(ctx, {
        action: 'evidence.contradiction_resolved',
        subject: { type: 'comparison', id: comparisonId },
        note,
        before: { resolved: before.resolvedAt !== null },
        after: {
          resolved: true,
          itemId: before.itemId,
          otherItemId: before.otherItemId,
          standingItemId: input.standingItemId,
        },
      });
    },

    /** The newest mapping run's comparisons for the job: open and resolved contradictions, and agreements. */
    async listComparisons(ctx: WorkspaceContext, candidateId: string, jobId: string): Promise<Comparison[]> {
      await authorize(ctx, 'candidate.view', (await candidateJob(ctx, candidateId, jobId)) ?? undefined);
      return storeFor(ctx.tx).comparisons(ctx.workspaceId, candidateId, jobId);
    },

    /** A person's link; a changed level is audited with the old and new level and the reason (AIV-P2-063). */
    async linkToCompetency(ctx: WorkspaceContext, itemId: string, link: CompetencyLink, reason: string): Promise<void> {
      await authorize(ctx, 'candidate.create');
      checkLink(link);
      const note = reason.trim();
      if (!note) throw new EvidenceError('level_reason');
      const before = await storeFor(ctx.tx).link(ctx.workspaceId, itemId, link);
      if (!before) throw new EvidenceError('not_found');
      if (before.level === link.level) return;
      await audit(ctx, {
        action: 'evidence.level_changed',
        subject: { type: 'evidence_item', id: itemId },
        note,
        before: { level: before.level },
        after: { level: link.level, jobId: link.jobId, competencyId: link.competencyId },
      });
    },

    // shortcut: no paging; a candidate holds tens of items, not thousands. Page when the evidence profile needs it.
    async listEvidenceForCandidate(ctx: WorkspaceContext, candidateId: string, jobId: string) {
      await authorize(ctx, 'candidate.view', (await candidateJob(ctx, candidateId, jobId)) ?? undefined);
      return storeFor(ctx.tx).list(ctx.workspaceId, { candidateId }, jobId);
    },

    async getEvidenceItem(ctx: WorkspaceContext, itemId: string): Promise<EvidenceItemView | null> {
      await authorize(ctx, 'candidate.view');
      const [item] = await storeFor(ctx.tx).list(ctx.workspaceId, { itemId }, null);
      return item ?? null;
    },

    /** The candidate's sources grouped into origins: near-duplicate sources form one (AIV-P1-071, for AIV-P1-029). */
    async listOriginGroups(ctx: WorkspaceContext, candidateId: string): Promise<string[][]> {
      await authorize(ctx, 'candidate.view');
      return groupOrigins(await storeFor(ctx.tx).fingerprints(ctx.workspaceId, candidateId));
    },

    async listDuplicateFlags(ctx: WorkspaceContext, candidateId: string): Promise<DuplicateFlag[]> {
      await authorize(ctx, 'candidate.view');
      return storeFor(ctx.tx).flags(ctx.workspaceId, candidateId);
    },

    /** A person's reading of a flag. Changes the flag alone: no score, rank, stage or contact (AGENTS.md 1.5). */
    async resolveDuplicateFlag(ctx: WorkspaceContext, flagId: string, resolution: DuplicateResolution): Promise<void> {
      await authorize(ctx, 'candidate.create');
      if (!DUPLICATE_RESOLUTIONS.includes(resolution)) throw new EvidenceError('resolution');
      const before = await storeFor(ctx.tx).resolveFlag(ctx.workspaceId, flagId, {
        resolution,
        resolvedBy: ctx.userId,
        resolvedAt: now(),
      });
      if (!before) throw new EvidenceError('flag_not_found');
      await audit(ctx, {
        action: 'evidence.flag_resolved',
        subject: { type: 'duplicate_flag', id: flagId },
        before: { resolution: before.resolution },
        after: { resolution, sourceId: before.sourceId, otherSourceId: before.otherSourceId },
      });
    },

    /** The demo seed's reset (AIV-P0-031): admins; refuses a workspace holding any evidence not synthetic. */
    async purgeSyntheticEvidence(ctx: WorkspaceContext): Promise<void> {
      await authorize(ctx, 'workspace.settings');
      if (!(await isSyntheticWorkspace(ctx))) throw new EvidenceError('not_synthetic');
      if (!(await storeFor(ctx.tx).deleteSynthetic(ctx.workspaceId))) throw new EvidenceError('not_synthetic');
    },
  };
}

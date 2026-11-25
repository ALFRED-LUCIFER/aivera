import type { Tx } from '@credalent/db';
import { ForbiddenError, type Action, type JobResource, type WorkspaceContext } from '@credalent/workspaces';
import { z } from 'zod';
import {
  coversMembers,
  DECISIONS,
  mayDecide,
  NAME_MAX,
  newMembers,
  NOTE_MAX,
  PackError,
  type Decision,
  type DecisionPack,
  type PackMember,
  type PackStatus,
} from '../domain/pack.ts';

/** The store over one workspace-scoped transaction. Every method filters by `workspaceId`. */
export type PackStore = {
  insertPack(pack: DecisionPack): Promise<void>;
  /** With `lock`, holds the pack's row until commit, so adding members and recording decisions cannot interleave. */
  findPack(workspaceId: string, packId: string, lock?: boolean): Promise<DecisionPack | null>;
  setStatus(workspaceId: string, packId: string, status: PackStatus): Promise<void>;
  /** Members are only ever inserted: a snapshot is never rewritten. */
  insertMembers(members: PackMember[]): Promise<void>;
  /** In pack order. */
  listMembers(workspaceId: string, packId: string): Promise<PackMember[]>;
  insertDecisions(decisions: Decision[]): Promise<void>;
  listDecisions(workspaceId: string, packId: string): Promise<Decision[]>;
  /** The job's packs, newest first, each with its members' candidate ids in pack order. */
  listForJob(workspaceId: string, jobId: string): Promise<PackSummary[]>;
};

/** A pack as the ranking needs it (AIV-P2-010): which packs the job has and who is in each. */
export type PackSummary = Pick<DecisionPack, 'id' | 'name' | 'status' | 'preparedAt'> & { candidateIds: string[] };

/** The job a pack belongs to, as the context may see it, with the member who owns its hiring decision. */
export type PackJob = JobResource & { hiringOwnerUserId: string | null };

export type Ports = {
  storeFor(tx: Tx): PackStore;
  /** Writes `PackReady.v1` to the outbox in `tx`, so it commits only with the pack (AIV-P0-014). */
  publishPackReady(tx: Tx, pack: DecisionPack): Promise<void>;
  /** Writes one `DecisionsRecorded.v1` for the pack to the outbox in `tx`. */
  publishDecisionsRecorded(tx: Tx, pack: DecisionPack, at: Date): Promise<void>;
  authorize(ctx: WorkspaceContext, action: Action, resource?: JobResource): Promise<void>;
  /** The job, or null when the context cannot see it (the jobs contract's `getJob`, under RLS). */
  job(ctx: WorkspaceContext, jobId: string): Promise<PackJob | null>;
  /** The job's approved rubric version and the candidates ranked on it, or null while none is approved. */
  ranking(ctx: WorkspaceContext, jobId: string): Promise<{ rubricVersionId: string; candidateIds: string[] } | null>;
  /** The candidate's latest stored assessment for the job, or null. */
  latestAssessment(
    ctx: WorkspaceContext,
    candidateId: string,
    jobId: string,
  ): Promise<{ id: string; rubricVersionId: string; backedScore: number; upperBound: number } | null>;
  /** Writes `decision.recorded` to the audit log in `ctx.tx`: the last statements before commit (AGENTS.md 3.6). */
  auditDecision(ctx: WorkspaceContext, jobId: string, decision: Decision): Promise<void>;
  newId(): string;
  now(): Date;
};

const memberInput = z.strictObject({ candidateId: z.uuid() });
const membersInput = z.array(memberInput).min(1).max(50);

/** Validated in the use case, whatever the caller checked (AGENTS.md 3.7). */
export const createPackInputSchema = z.strictObject({
  jobId: z.uuid(),
  name: z.string().trim().min(1).max(NAME_MAX),
  members: membersInput,
});
export type CreatePackInput = z.input<typeof createPackInputSchema>;
export type MemberInput = z.input<typeof memberInput>;

export const recordDecisionsInputSchema = z.strictObject({
  packId: z.uuid(),
  decisions: z
    .array(
      z.strictObject({
        candidateId: z.uuid(),
        decision: z.enum(DECISIONS),
        note: z.string().trim().min(1).max(NOTE_MAX),
      }),
    )
    .min(1)
    .max(50),
});
export type RecordDecisionsInput = z.input<typeof recordDecisionsInputSchema>;

/** A pack with its members in order and the decisions recorded on it (none until it is `decided`). */
export type PackView = DecisionPack & { members: PackMember[]; decisions: Decision[] };

export function packUseCases(ports: Ports) {
  const { storeFor, authorize, now } = ports;

  /** The stored pack and its job when the context may see the job; the job comes from the pack, never the request. */
  async function visible(ctx: WorkspaceContext, packId: string, lock = false) {
    const pack = await storeFor(ctx.tx).findPack(ctx.workspaceId, packId, lock);
    const job = pack && (await ports.job(ctx, pack.jobId));
    return pack && job ? { pack, job } : null;
  }

  /** A member per candidate, each with the scores of their latest assessment on the pack's rubric version, read now. */
  async function snapshot(
    ctx: WorkspaceContext,
    pack: Pick<DecisionPack, 'id' | 'jobId' | 'rubricVersionId'>,
    ranked: readonly string[],
    adding: readonly z.output<typeof memberInput>[],
    from: number,
  ): Promise<PackMember[]> {
    const members: PackMember[] = [];
    for (const [i, { candidateId }] of adding.entries()) {
      // Ranked: assessed on the approved version and still applying to this job (a merged person is not).
      const latest = ranked.includes(candidateId) && (await ports.latestAssessment(ctx, candidateId, pack.jobId));
      if (!latest || latest.rubricVersionId !== pack.rubricVersionId) throw new PackError('candidate_not_assessed');
      members.push({
        workspaceId: ctx.workspaceId,
        packId: pack.id,
        candidateId,
        assessmentId: latest.id,
        backedScore: latest.backedScore,
        upperBound: latest.upperBound,
        position: from + i,
      });
    }
    return members;
  }

  return {
    async createPack(ctx: WorkspaceContext, raw: CreatePackInput): Promise<{ packId: string }> {
      const input = createPackInputSchema.parse(raw);
      const job = await ports.job(ctx, input.jobId);
      if (!job) throw new PackError('job_not_found');
      await authorize(ctx, 'pack.prepare', job);
      const ranking = await ports.ranking(ctx, job.jobId);
      if (!ranking) throw new PackError('rubric_not_approved');
      const pack: DecisionPack = {
        id: ports.newId(),
        workspaceId: ctx.workspaceId,
        jobId: job.jobId,
        rubricVersionId: ranking.rubricVersionId,
        name: input.name,
        preparedBy: ctx.userId,
        preparedAt: now(),
        status: 'ready',
      };
      const members = await snapshot(ctx, pack, ranking.candidateIds, newMembers([], input.members), 0);
      const store = storeFor(ctx.tx);
      await store.insertPack(pack);
      await store.insertMembers(members);
      await ports.publishPackReady(ctx.tx, pack);
      return { packId: pack.id };
    },

    async addMembers(ctx: WorkspaceContext, packId: string, raw: MemberInput[]): Promise<{ added: number }> {
      const adding = membersInput.parse(raw);
      const found = z.uuid().safeParse(packId).success ? await visible(ctx, packId, true) : null;
      if (!found) throw new PackError('pack_not_found');
      const { pack, job } = found;
      await authorize(ctx, 'pack.prepare', job);
      if (pack.status === 'decided') throw new PackError('pack_decided');
      const store = storeFor(ctx.tx);
      const inPack = await store.listMembers(ctx.workspaceId, pack.id);
      const fresh = newMembers(
        inPack.map((m) => m.candidateId),
        adding,
      );
      if (fresh.length === 0) return { added: 0 };
      // A pack is on one rubric version: once the job's approved version moves on, nobody ranked on it can join.
      const ranking = await ports.ranking(ctx, job.jobId);
      const ranked = ranking?.rubricVersionId === pack.rubricVersionId ? ranking.candidateIds : [];
      await store.insertMembers(await snapshot(ctx, pack, ranked, fresh, inPack.length));
      return { added: fresh.length };
    },

    async listPacks(ctx: WorkspaceContext, jobId: string): Promise<PackSummary[]> {
      const job = z.uuid().safeParse(jobId).success ? await ports.job(ctx, jobId) : null;
      if (!job) throw new PackError('job_not_found');
      await authorize(ctx, 'pack.view', job);
      return storeFor(ctx.tx).listForJob(ctx.workspaceId, job.jobId);
    },

    async getPack(ctx: WorkspaceContext, packId: string): Promise<PackView | null> {
      const found = z.uuid().safeParse(packId).success ? await visible(ctx, packId) : null;
      if (!found) return null;
      await authorize(ctx, 'pack.view', found.job);
      const store = storeFor(ctx.tx);
      return {
        ...found.pack,
        members: await store.listMembers(ctx.workspaceId, packId),
        decisions: await store.listDecisions(ctx.workspaceId, packId),
      };
    },

    /** Stores the decisions and one event. It moves no stage and contacts nobody (AGENTS.md 1.5). */
    async recordDecisions(ctx: WorkspaceContext, raw: RecordDecisionsInput): Promise<void> {
      const input = recordDecisionsInputSchema.parse(raw);
      const found = await visible(ctx, input.packId, true);
      if (!found) throw new PackError('pack_not_found');
      const { pack, job } = found;
      await authorize(ctx, 'decision.record', job);
      if (!mayDecide(ctx, job)) throw new ForbiddenError();
      if (pack.status !== 'ready') throw new PackError(pack.status === 'decided' ? 'pack_decided' : 'pack_not_ready');
      const store = storeFor(ctx.tx);
      const members = (await store.listMembers(ctx.workspaceId, pack.id)).map((m) => m.candidateId);
      const decided = input.decisions.map((d) => d.candidateId);
      if (!coversMembers(members, decided)) throw new PackError('decisions_incomplete');
      const decidedAt = now();
      const decisions: Decision[] = input.decisions.map((d) => ({
        workspaceId: ctx.workspaceId,
        packId: pack.id,
        candidateId: d.candidateId,
        decision: d.decision,
        decidedBy: ctx.userId,
        decidedAt,
        note: d.note,
      }));
      await store.insertDecisions(decisions);
      await store.setStatus(ctx.workspaceId, pack.id, 'decided');
      await ports.publishDecisionsRecorded(ctx.tx, pack, decidedAt);
      for (const decision of decisions) await ports.auditDecision(ctx, job.jobId, decision);
    },
  };
}

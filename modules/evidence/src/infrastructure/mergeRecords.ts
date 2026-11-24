import { DbQueryError, type Tx } from '@credalent/db/client';
import { enqueue } from '@credalent/db/outbox';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { EvidenceRecordedV1 } from '../contracts/index.ts';
import { item, mergedPullRequest, outbox, request, source } from './schema.ts';

/** What a duplicate merge moved (AIV-P1-018), stored with the merge and read back for its undo. */
const movedSchema = z.strictObject({ sourceIds: z.array(z.uuid()), requestIds: z.array(z.uuid()) });

// A source whose move would break a uniqueness rule stays: the survivor already holds the same link, repository or
// pull request, or a near-duplicate flag joins it to the survivor's own source.
const kept = (error: unknown) => error instanceof DbQueryError && (error.code === '23505' || error.code === '23514');

/** Moves one source to `toId`; its items, reads, notes and flags follow by ON UPDATE CASCADE (0028). */
async function moveSource(tx: Tx, workspaceId: string, sourceId: string, fromId: string, toId: string) {
  await tx
    .update(source)
    .set({ candidateId: toId })
    .where(and(eq(source.workspaceId, workspaceId), eq(source.id, sourceId), eq(source.candidateId, fromId)));
  // Merged pull requests name the candidate beside their item; they follow the item's source.
  await tx
    .update(mergedPullRequest)
    .set({ candidateId: toId })
    .where(
      and(
        eq(mergedPullRequest.workspaceId, workspaceId),
        inArray(
          mergedPullRequest.itemId,
          tx
            .select({ id: item.id })
            .from(item)
            .where(and(eq(item.workspaceId, workspaceId), eq(item.sourceId, sourceId))),
        ),
      ),
    );
}

const sourcesOf = async (tx: Tx, workspaceId: string, candidateId: string) =>
  (
    await tx
      .select({ id: source.id })
      .from(source)
      .where(and(eq(source.workspaceId, workspaceId), eq(source.candidateId, candidateId)))
      .orderBy(asc(source.createdAt), asc(source.id))
  ).map((r) => r.id);

async function moveRequests(tx: Tx, workspaceId: string, fromId: string, toId: string, ids?: string[]) {
  // One open request per candidate and job: an open one stays when the target already has one for that job.
  const rows = await tx
    .update(request)
    .set({ candidateId: toId })
    .where(
      and(
        eq(request.workspaceId, workspaceId),
        eq(request.candidateId, fromId),
        ids ? inArray(request.id, ids) : undefined,
        sql`(${request.status} = 'closed' or not exists (select 1 from ${request} r where r.workspace_id = ${workspaceId}
          and r.candidate_id = ${toId} and r.job_id = "request"."job_id" and r.status <> 'closed'))`,
      ),
    )
    .returning({ id: request.id });
  return rows.map((r) => r.id);
}

/**
 * A person's evidence for a duplicate merge (AIV-P1-018), in the merge's transaction. Moves each source (and what
 * hangs off it) and the open evidence requests to the survivor, then writes `EvidenceRecorded.v1` so the survivor is
 * mapped and assessed again (AIV-P1-027, AIV-P1-031); the undo moves back exactly those and does the same for both.
 * Mapping runs and assessment results are history and stay where they are: the new run replaces them. Not authorised
 * itself: apps wire it into `createCandidates`, whose merge authorises the change.
 */
export function createEvidenceRecords(now: () => Date = () => new Date()) {
  /** Assess the candidate again for every job they applied to, if they have evidence at all. */
  async function reassess(tx: Tx, workspaceId: string, candidateId: string, dedupeKey: string) {
    const [sourceId] = await sourcesOf(tx, workspaceId, candidateId);
    if (sourceId)
      await enqueue(tx, outbox, EvidenceRecordedV1, {
        workspaceId,
        payload: { candidateId, sourceId, itemIds: [] },
        dedupeKey,
        occurredAt: now(),
      });
  }

  return {
    async count(tx: Tx, workspaceId: string, candidateId: string) {
      const [row] = await tx
        .select({ n: count() })
        .from(source)
        .where(and(eq(source.workspaceId, workspaceId), eq(source.candidateId, candidateId)));
      return row?.n ?? 0;
    },

    async move(tx: Tx, workspaceId: string, fromId: string, toId: string, mergeId: string) {
      const sourceIds: string[] = [];
      for (const id of await sourcesOf(tx, workspaceId, fromId)) {
        try {
          // A savepoint, so a source that must stay leaves the merge's transaction usable.
          await tx.transaction((sp) => moveSource(sp, workspaceId, id, fromId, toId));
          sourceIds.push(id);
        } catch (error) {
          if (!kept(error)) throw error;
        }
      }
      const requestIds = await moveRequests(tx, workspaceId, fromId, toId);
      await reassess(tx, workspaceId, toId, `merge:${mergeId}:${toId}`);
      return { moved: { sourceIds, requestIds } satisfies z.infer<typeof movedSchema>, count: sourceIds.length };
    },

    async restore(tx: Tx, workspaceId: string, fromId: string, toId: string, stored: unknown, mergeId: string) {
      const moved = movedSchema.parse(stored);
      for (const id of moved.sourceIds) await moveSource(tx, workspaceId, id, toId, fromId);
      if (moved.requestIds.length > 0) await moveRequests(tx, workspaceId, toId, fromId, moved.requestIds);
      await reassess(tx, workspaceId, fromId, `unmerge:${mergeId}:${fromId}`);
      await reassess(tx, workspaceId, toId, `unmerge:${mergeId}:${toId}`);
    },
  };
}

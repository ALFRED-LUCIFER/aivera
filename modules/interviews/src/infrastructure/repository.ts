import type { Tx } from '@credalent/db/client';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { InterviewStore } from '../application/interviews.ts';
import { interview, scorecardDrafts } from './schema.ts';

/**
 * The interviews store over a workspace-scoped transaction. The `workspace_id` filter here is the first layer;
 * row-level security on the transaction's `app.workspace_id` is the second (ADR-005).
 */
export function interviewStore(tx: Tx): InterviewStore {
  return {
    async insert(values) {
      await tx.insert(interview).values(values);
    },
    async find(workspaceId, interviewId) {
      const [row] = await tx
        .select()
        .from(interview)
        .where(and(eq(interview.workspaceId, workspaceId), eq(interview.id, interviewId)));
      return row ?? null;
    },
    async moveStatus(workspaceId, interviewId, from, to) {
      const moved = await tx
        .update(interview)
        .set({ status: to })
        .where(and(eq(interview.workspaceId, workspaceId), eq(interview.id, interviewId), eq(interview.status, from)))
        .returning({ id: interview.id });
      return moved.length === 1;
    },
    list(workspaceId, statuses, interviewerUserId) {
      return tx
        .select()
        .from(interview)
        .where(
          and(
            eq(interview.workspaceId, workspaceId),
            inArray(interview.status, [...statuses]),
            interviewerUserId ? eq(interview.interviewerUserId, interviewerUserId) : undefined,
          ),
        )
        .orderBy(sql`${interview.scheduledAt} asc nulls last`, asc(interview.createdAt), asc(interview.id));
    },
    async findDraft(workspaceId, interviewId) {
      const [row] = await tx
        .select({ competencies: scorecardDrafts.competencies, recommendation: scorecardDrafts.recommendation })
        .from(scorecardDrafts)
        .where(and(eq(scorecardDrafts.workspaceId, workspaceId), eq(scorecardDrafts.interviewId, interviewId)));
      return row ?? null;
    },
    async saveDraft(row) {
      const { interviewId: _id, workspaceId: _workspace, ...values } = row;
      await tx
        .insert(scorecardDrafts)
        .values(row)
        .onConflictDoUpdate({
          target: scorecardDrafts.interviewId,
          set: values,
          setWhere: eq(scorecardDrafts.workspaceId, row.workspaceId),
        });
    },
    async deleteAll(workspaceId) {
      await tx.delete(interview).where(eq(interview.workspaceId, workspaceId));
    },
  };
}

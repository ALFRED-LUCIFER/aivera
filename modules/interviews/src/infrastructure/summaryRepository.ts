import type { Tx } from '@credalent/db/client';
import { and, asc, desc, eq, inArray, notInArray } from 'drizzle-orm';
import type { SummaryStore } from '../application/summary.ts';
import { meetingSummaries, summaryProposals } from './schema.ts';

/**
 * The meeting summaries store over a workspace-scoped transaction (AIV-P1-115). The `workspace_id` filter here is the
 * first layer; row-level security on the transaction's `app.workspace_id` is the second (ADR-005).
 */
export function summaryStore(tx: Tx): SummaryStore {
  return {
    async insert(summary) {
      await tx.insert(meetingSummaries).values(summary);
    },
    async find(workspaceId, summaryId) {
      const [row] = await tx
        .select()
        .from(meetingSummaries)
        .where(and(eq(meetingSummaries.workspaceId, workspaceId), eq(meetingSummaries.id, summaryId)));
      return row ?? null;
    },
    async latest(workspaceId, interviewId) {
      const [row] = await tx
        .select()
        .from(meetingSummaries)
        .where(and(eq(meetingSummaries.workspaceId, workspaceId), eq(meetingSummaries.interviewId, interviewId)))
        .orderBy(desc(meetingSummaries.createdAt), desc(meetingSummaries.id))
        .limit(1);
      return row ?? null;
    },
    async move(workspaceId, summaryId, from, to, promptVersion) {
      const moved = await tx
        .update(meetingSummaries)
        .set({ status: to, ...(promptVersion && { promptVersion }) })
        .where(
          and(
            eq(meetingSummaries.workspaceId, workspaceId),
            eq(meetingSummaries.id, summaryId),
            inArray(meetingSummaries.status, [...from]),
          ),
        )
        .returning({ id: meetingSummaries.id });
      return moved.length === 1;
    },
    async insertProposals(workspaceId, summaryId, proposals) {
      if (proposals.length)
        await tx.insert(summaryProposals).values(proposals.map((p) => ({ ...p, workspaceId, summaryId })));
    },
    async proposals(workspaceId, summaryId) {
      const rows = await tx
        .select()
        .from(summaryProposals)
        .where(and(eq(summaryProposals.workspaceId, workspaceId), eq(summaryProposals.summaryId, summaryId)))
        .orderBy(asc(summaryProposals.competencyId));
      return rows.map(({ workspaceId: _workspace, summaryId: _summary, ...proposal }) => proposal);
    },
    async markProposals(workspaceId, summaryId, status, competencyIds, others = false) {
      const scope = and(eq(summaryProposals.workspaceId, workspaceId), eq(summaryProposals.summaryId, summaryId));
      if (!others && competencyIds.length === 0) return;
      const which = others
        ? competencyIds.length
          ? notInArray(summaryProposals.competencyId, [...competencyIds])
          : undefined
        : inArray(summaryProposals.competencyId, [...competencyIds]);
      await tx.update(summaryProposals).set({ status }).where(and(scope, which));
    },
    async appliedCompetencies(workspaceId, interviewId) {
      const rows = await tx
        .selectDistinct({ competencyId: summaryProposals.competencyId })
        .from(summaryProposals)
        .innerJoin(
          meetingSummaries,
          and(
            eq(meetingSummaries.id, summaryProposals.summaryId),
            eq(meetingSummaries.workspaceId, summaryProposals.workspaceId),
          ),
        )
        .where(
          and(
            eq(summaryProposals.workspaceId, workspaceId),
            eq(meetingSummaries.interviewId, interviewId),
            eq(summaryProposals.status, 'applied'),
          ),
        );
      return rows.map((r) => r.competencyId);
    },
  };
}

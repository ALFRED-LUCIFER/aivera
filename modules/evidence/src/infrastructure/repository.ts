import type { Tx } from '@credalent/db/client';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { EvidenceStore } from '../application/evidence.ts';
import { competencyLink, item, source } from './schema.ts';

/**
 * The evidence store over a workspace-scoped transaction. The `workspace_id` filter here is the first layer;
 * row-level security on the transaction's `app.workspace_id` is the second (ADR-005).
 */
export function evidenceStore(tx: Tx): EvidenceStore {
  return {
    async insert(src, items, links) {
      await tx.insert(source).values(src);
      if (items.length) await tx.insert(item).values(items);
      if (links.length)
        await tx
          .insert(competencyLink)
          .values(links.map((l) => ({ ...l, workspaceId: src.workspaceId })))
          .onConflictDoNothing();
    },
    async link(workspaceId, itemId, { jobId, competencyId }) {
      const [found] = await tx
        .select({ id: item.id })
        .from(item)
        .where(and(eq(item.workspaceId, workspaceId), eq(item.id, itemId)));
      if (!found) return false;
      await tx.insert(competencyLink).values({ workspaceId, itemId, jobId, competencyId }).onConflictDoNothing();
      return true;
    },
    async list(workspaceId, { candidateId, itemId }, jobId) {
      const rows = await tx
        .select({ item, source })
        .from(item)
        .innerJoin(source, and(eq(source.workspaceId, item.workspaceId), eq(source.id, item.sourceId)))
        .where(
          and(
            eq(item.workspaceId, workspaceId),
            candidateId === undefined ? undefined : eq(item.candidateId, candidateId),
            itemId === undefined ? undefined : eq(item.id, itemId),
          ),
        )
        .orderBy(asc(item.createdAt), asc(item.id));
      if (rows.length === 0) return [];
      const links = await tx
        .select()
        .from(competencyLink)
        .where(
          and(
            eq(competencyLink.workspaceId, workspaceId),
            inArray(
              competencyLink.itemId,
              rows.map((r) => r.item.id),
            ),
            jobId === null ? undefined : eq(competencyLink.jobId, jobId),
          ),
        );
      return rows.map((r) => ({
        ...r.item,
        source: r.source,
        competencies: links
          .filter((l) => l.itemId === r.item.id)
          .map((l) => ({ jobId: l.jobId, competencyId: l.competencyId })),
      }));
    },
    async deleteSynthetic(workspaceId) {
      const [real] = await tx
        .select({ id: source.id })
        .from(source)
        .where(and(eq(source.workspaceId, workspaceId), eq(source.synthetic, false)))
        .limit(1);
      if (real) return false;
      await tx.delete(competencyLink).where(eq(competencyLink.workspaceId, workspaceId));
      await tx.delete(item).where(eq(item.workspaceId, workspaceId));
      await tx.delete(source).where(eq(source.workspaceId, workspaceId));
      return true;
    },
  };
}

import type { Tx } from '@credalent/db/client';
import { and, asc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { EvidenceStore } from '../application/evidence.ts';
import { competencyLink, duplicateFlag, item, source } from './schema.ts';

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
    async fingerprints(workspaceId, candidateId) {
      // Serialises comparisons per workspace until commit, so two copies recorded at once still see each other.
      if (candidateId === undefined) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`);
      return tx
        .select({ id: source.id, candidateId: source.candidateId, textFingerprint: source.textFingerprint })
        .from(source)
        .where(
          and(
            eq(source.workspaceId, workspaceId),
            candidateId === undefined ? isNotNull(source.textFingerprint) : eq(source.candidateId, candidateId),
          ),
        )
        .orderBy(asc(source.createdAt), asc(source.id));
    },
    async insertFlags(flags) {
      await tx.insert(duplicateFlag).values(flags);
    },
    flags(workspaceId, candidateId) {
      return tx
        .select()
        .from(duplicateFlag)
        .where(
          and(
            eq(duplicateFlag.workspaceId, workspaceId),
            or(eq(duplicateFlag.candidateId, candidateId), eq(duplicateFlag.otherCandidateId, candidateId)),
          ),
        )
        .orderBy(asc(duplicateFlag.createdAt), asc(duplicateFlag.id));
    },
    async resolveFlag(workspaceId, flagId, resolution) {
      const where = and(eq(duplicateFlag.workspaceId, workspaceId), eq(duplicateFlag.id, flagId));
      // Locked, so two people resolving at once are audited in the order they changed it.
      const [before] = await tx.select().from(duplicateFlag).where(where).for('update');
      if (!before) return null;
      await tx.update(duplicateFlag).set(resolution).where(where);
      return before;
    },
    async deleteSynthetic(workspaceId) {
      const [real] = await tx
        .select({ id: source.id })
        .from(source)
        .where(and(eq(source.workspaceId, workspaceId), eq(source.synthetic, false)))
        .limit(1);
      if (real) return false;
      await tx.delete(duplicateFlag).where(eq(duplicateFlag.workspaceId, workspaceId));
      await tx.delete(competencyLink).where(eq(competencyLink.workspaceId, workspaceId));
      await tx.delete(item).where(eq(item.workspaceId, workspaceId));
      await tx.delete(source).where(eq(source.workspaceId, workspaceId));
      return true;
    },
  };
}

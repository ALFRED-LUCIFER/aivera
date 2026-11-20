import { removeModuleVectors } from '@credalent/ai/search';
import type { Tx } from '@credalent/db/client';
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { EvidenceStore } from '../application/evidence.ts';
import { shownAs } from '../domain/corroboration.ts';
import {
  comparison,
  competencyLink,
  cvParse,
  documentRead,
  duplicateFlag,
  evidenceGap,
  item,
  linkRead,
  mapping,
  mergedPullRequest,
  repositoryRead,
  repositorySkillGrade,
  repositorySkillSignal,
  request,
  source,
  sourceNote,
} from './schema.ts';

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
    async link(workspaceId, itemId, { jobId, competencyId, level }) {
      const [found] = await tx
        .select({ id: item.id })
        .from(item)
        .where(and(eq(item.workspaceId, workspaceId), eq(item.id, itemId)));
      if (!found) return false;
      await tx
        .insert(competencyLink)
        .values({ workspaceId, itemId, jobId, competencyId, level })
        .onConflictDoUpdate({
          target: [competencyLink.workspaceId, competencyLink.itemId, competencyLink.competencyId],
          set: { level },
        });
      return true;
    },
    async list(workspaceId, { candidateId, itemId, unmapped }, jobId) {
      // For a job, a mapped item counts only from the candidate's newest mapping run for it (AIV-P1-027).
      const newestRun = (job: string) =>
        tx
          .select({ id: mapping.id })
          .from(mapping)
          .where(
            and(
              eq(mapping.workspaceId, item.workspaceId),
              eq(mapping.candidateId, item.candidateId),
              eq(mapping.jobId, job),
            ),
          )
          .orderBy(desc(mapping.createdAt), desc(mapping.id))
          .limit(1);
      const rows = await tx
        .select({ item, source })
        .from(item)
        .innerJoin(source, and(eq(source.workspaceId, item.workspaceId), eq(source.id, item.sourceId)))
        .where(
          and(
            eq(item.workspaceId, workspaceId),
            candidateId === undefined ? undefined : eq(item.candidateId, candidateId),
            itemId === undefined ? undefined : eq(item.id, itemId),
            unmapped ? isNull(item.mappingId) : undefined,
            jobId === null ? undefined : or(isNull(item.mappingId), sql`${item.mappingId} = (${newestRun(jobId)})`),
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
      const ids = rows.map((r) => r.item.id);
      // An open contradiction shows its items as "Contradictory"; a resolved one, its limit (AIV-P1-029).
      const comparisons = await tx
        .select()
        .from(comparison)
        .where(
          and(
            eq(comparison.workspaceId, workspaceId),
            eq(comparison.outcome, 'contradiction'),
            or(inArray(comparison.itemId, ids), inArray(comparison.otherItemId, ids)),
          ),
        );
      return rows.map(({ item: { mappingId: _run, ...own }, source: src }) => ({
        ...own,
        ...shownAs(own, comparisons),
        source: src,
        competencies: links
          .filter((l) => l.itemId === own.id)
          .map((l) => ({ jobId: l.jobId, competencyId: l.competencyId, level: l.level })),
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
    async resolveComparison(workspaceId, comparisonId, resolution) {
      const where = and(
        eq(comparison.workspaceId, workspaceId),
        eq(comparison.id, comparisonId),
        eq(comparison.outcome, 'contradiction'),
      );
      // Locked, so two people resolving at once are audited in the order they changed it.
      const [before] = await tx.select().from(comparison).where(where).for('update');
      if (!before) return null;
      await tx.update(comparison).set(resolution).where(where);
      return before;
    },
    comparisons(workspaceId, candidateId, jobId) {
      const newest = tx
        .select({ id: mapping.id })
        .from(mapping)
        .where(
          and(eq(mapping.workspaceId, workspaceId), eq(mapping.candidateId, candidateId), eq(mapping.jobId, jobId)),
        )
        .orderBy(desc(mapping.createdAt), desc(mapping.id))
        .limit(1);
      return tx
        .select()
        .from(comparison)
        .where(and(eq(comparison.workspaceId, workspaceId), sql`${comparison.mappingId} = (${newest})`))
        .orderBy(asc(comparison.createdAt), asc(comparison.id));
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
      await tx.delete(mergedPullRequest).where(eq(mergedPullRequest.workspaceId, workspaceId));
      await tx.delete(repositorySkillGrade).where(eq(repositorySkillGrade.workspaceId, workspaceId));
      await tx.delete(repositorySkillSignal).where(eq(repositorySkillSignal.workspaceId, workspaceId));
      await tx.delete(repositoryRead).where(eq(repositoryRead.workspaceId, workspaceId));
      await tx.delete(cvParse).where(eq(cvParse.workspaceId, workspaceId));
      await tx.delete(documentRead).where(eq(documentRead.workspaceId, workspaceId));
      await tx.delete(linkRead).where(eq(linkRead.workspaceId, workspaceId));
      // The items' vectors (hashes and offsets, owned by the item ids) go with them.
      await removeModuleVectors(tx, workspaceId, 'evidence');
      await tx.delete(sourceNote).where(eq(sourceNote.workspaceId, workspaceId));
      // Requests first: their items reference evidence items; the cascade takes request items and portal tokens.
      await tx.delete(request).where(eq(request.workspaceId, workspaceId));
      await tx.delete(comparison).where(eq(comparison.workspaceId, workspaceId));
      await tx.delete(item).where(eq(item.workspaceId, workspaceId));
      await tx.delete(evidenceGap).where(eq(evidenceGap.workspaceId, workspaceId));
      await tx.delete(mapping).where(eq(mapping.workspaceId, workspaceId));
      await tx.delete(source).where(eq(source.workspaceId, workspaceId));
      return true;
    },
  };
}

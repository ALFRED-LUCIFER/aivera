import type { Tx } from '@credalent/db/client';
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { MappingStore } from '../application/mapping.ts';
import { pairKey, type Resolution } from '../domain/corroboration.ts';
import { comparison, competencyLink, evidenceGap, item, mapping } from './schema.ts';

/** Mapping runs over a workspace-scoped transaction: the workspace filter here, row-level security below it. */
export function mappingStore(tx: Tx): MappingStore {
  return {
    async insert(run, items, links, gaps, comparisons) {
      await tx.insert(mapping).values(run);
      if (items.length) await tx.insert(item).values(items);
      if (links.length)
        await tx.insert(competencyLink).values(links.map((l) => ({ ...l, workspaceId: run.workspaceId })));
      if (gaps.length)
        await tx.insert(evidenceGap).values(
          gaps.map(({ coverage, ...g }) => ({
            ...g,
            filesInspected: coverage?.filesInspected ?? null,
            coverageReason: coverage?.reason ?? null,
          })),
        );
      if (comparisons.length) await tx.insert(comparison).values(comparisons);
    },
    async resolutions(workspaceId, candidateId, jobId) {
      const other = alias(item, 'other_item');
      const rows = await tx
        .select({
          first: { sourceId: item.sourceId, excerpt: item.excerpt },
          second: { sourceId: other.sourceId, excerpt: other.excerpt },
          resolvedBy: comparison.resolvedBy,
          resolvedAt: comparison.resolvedAt,
          resolutionNote: comparison.resolutionNote,
          resolutionLimit: comparison.resolutionLimit,
        })
        .from(comparison)
        .innerJoin(item, and(eq(item.workspaceId, comparison.workspaceId), eq(item.id, comparison.itemId)))
        .innerJoin(other, and(eq(other.workspaceId, comparison.workspaceId), eq(other.id, comparison.otherItemId)))
        .where(
          and(
            eq(comparison.workspaceId, workspaceId),
            eq(comparison.candidateId, candidateId),
            eq(comparison.jobId, jobId),
            isNotNull(comparison.resolvedAt),
          ),
        )
        // Oldest first, so the latest resolution of a pair wins in the map.
        .orderBy(asc(comparison.resolvedAt));
      return new Map<string, Resolution>(rows.map(({ first, second, ...r }) => [pairKey(first, second), r]));
    },
    async aiFlags(workspaceId, candidateId, jobId) {
      const other = alias(item, 'other_item');
      const rows = await tx
        .select({
          first: { sourceId: item.sourceId, excerpt: item.excerpt },
          second: { sourceId: other.sourceId, excerpt: other.excerpt },
        })
        .from(comparison)
        .innerJoin(item, and(eq(item.workspaceId, comparison.workspaceId), eq(item.id, comparison.itemId)))
        .innerJoin(other, and(eq(other.workspaceId, comparison.workspaceId), eq(other.id, comparison.otherItemId)))
        .where(
          and(
            eq(comparison.workspaceId, workspaceId),
            eq(comparison.candidateId, candidateId),
            eq(comparison.jobId, jobId),
            eq(comparison.method, 'ai'),
          ),
        );
      return new Set(rows.map(({ first, second }) => pairKey(first, second)));
    },
    async newest(workspaceId, candidateId, jobId) {
      const [run] = await tx
        .select()
        .from(mapping)
        .where(
          and(eq(mapping.workspaceId, workspaceId), eq(mapping.candidateId, candidateId), eq(mapping.jobId, jobId)),
        )
        .orderBy(desc(mapping.createdAt), desc(mapping.id))
        .limit(1);
      if (!run) return null;
      const gaps = await tx
        .select()
        .from(evidenceGap)
        .where(and(eq(evidenceGap.workspaceId, workspaceId), eq(evidenceGap.mappingId, run.id)))
        .orderBy(asc(evidenceGap.competencyId));
      return {
        ...run,
        gaps: gaps.map(({ filesInspected, coverageReason, ...g }) => ({
          ...g,
          coverage:
            filesInspected === null || coverageReason === null ? null : { filesInspected, reason: coverageReason },
        })),
      };
    },
  };
}

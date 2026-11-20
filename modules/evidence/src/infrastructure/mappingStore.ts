import type { Tx } from '@credalent/db/client';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { MappingStore } from '../application/mapping.ts';
import { competencyLink, evidenceGap, item, mapping } from './schema.ts';

/** Mapping runs over a workspace-scoped transaction: the workspace filter here, row-level security below it. */
export function mappingStore(tx: Tx): MappingStore {
  return {
    async insert(run, items, links, gaps) {
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

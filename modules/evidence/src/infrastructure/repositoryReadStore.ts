import type { Tx } from '@credalent/db/client';
import { and, eq } from 'drizzle-orm';
import type { RepositoryReadStore } from '../application/repositoryRead.ts';
import { item, mergedPullRequest, repositoryRead, source } from './schema.ts';

/** Repository reads over a workspace-scoped transaction: the workspace filter here, row-level security below it. */
export function repositoryReadStore(tx: Tx): RepositoryReadStore {
  return {
    async insert(read) {
      await tx.insert(repositoryRead).values(read);
    },
    async find(workspaceId, sourceId) {
      const [row] = await tx
        .select({ read: repositoryRead, source })
        .from(repositoryRead)
        .innerJoin(
          source,
          and(eq(source.workspaceId, repositoryRead.workspaceId), eq(source.id, repositoryRead.sourceId)),
        )
        .where(and(eq(repositoryRead.workspaceId, workspaceId), eq(repositoryRead.sourceId, sourceId)));
      return row ?? null;
    },
    async finish(read, checkedAt, checkMethod) {
      const { workspaceId, sourceId, ...change } = read;
      await tx
        .update(repositoryRead)
        .set(change)
        .where(and(eq(repositoryRead.workspaceId, workspaceId), eq(repositoryRead.sourceId, sourceId)));
      await tx
        .update(source)
        .set({ checkedAt, checkMethod })
        .where(and(eq(source.workspaceId, workspaceId), eq(source.id, sourceId)));
    },
    async insertItems(items, pulls) {
      if (items.length) await tx.insert(item).values(items);
      if (pulls.length) await tx.insert(mergedPullRequest).values(pulls);
    },
    async knownPullRequests(workspaceId, candidateId) {
      const rows = await tx
        .select({ repository: mergedPullRequest.repository, number: mergedPullRequest.number })
        .from(mergedPullRequest)
        .where(and(eq(mergedPullRequest.workspaceId, workspaceId), eq(mergedPullRequest.candidateId, candidateId)));
      return new Set(rows.map((r) => `${r.repository}#${r.number}`));
    },
  };
}

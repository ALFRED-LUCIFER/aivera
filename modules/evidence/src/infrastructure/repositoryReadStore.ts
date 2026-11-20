import type { Tx } from '@credalent/db/client';
import { and, asc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import type { RepositoryReadStore } from '../application/repositoryRead.ts';
import type { SkillSignal } from '../domain/skill-signals/classify.ts';
import {
  item,
  mergedPullRequest,
  repositoryRead,
  repositorySkillGrade,
  repositorySkillSignal,
  source,
} from './schema.ts';

/** Repository reads over a workspace-scoped transaction: the workspace filter here, row-level security below it. */
export function repositoryReadStore(tx: Tx): RepositoryReadStore {
  async function replaceSignals(workspaceId: string, sourceId: string, signals: SkillSignal[]) {
    await tx
      .delete(repositorySkillSignal)
      .where(and(eq(repositorySkillSignal.workspaceId, workspaceId), eq(repositorySkillSignal.sourceId, sourceId)));
    if (signals.length)
      await tx
        .insert(repositorySkillSignal)
        .values(signals.map((signal, position) => ({ ...signal, workspaceId, sourceId, position })));
  }

  return {
    async insertOrGet(src, read) {
      await tx.insert(source).values(src);
      // ON CONFLICT waits for a concurrent insert of the same candidate and URL, so two requests at once keep one read.
      const [inserted] = await tx
        .insert(repositoryRead)
        .values(read)
        .onConflictDoNothing({ target: [repositoryRead.workspaceId, repositoryRead.candidateId, repositoryRead.url] })
        .returning({ sourceId: repositoryRead.sourceId });
      if (inserted) return null;
      await tx.delete(source).where(and(eq(source.workspaceId, src.workspaceId), eq(source.id, src.id)));
      const [existing] = await tx
        .select({ sourceId: repositoryRead.sourceId })
        .from(repositoryRead)
        .where(
          and(
            eq(repositoryRead.workspaceId, read.workspaceId),
            eq(repositoryRead.candidateId, read.candidateId),
            eq(repositoryRead.url, read.url),
          ),
        );
      if (!existing) throw new Error('repository read conflict but no read for this candidate and URL');
      return existing.sourceId;
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
    async lockForCandidate(workspaceId, candidateId) {
      return tx
        .select({ read: repositoryRead, source })
        .from(repositoryRead)
        .innerJoin(
          source,
          and(eq(source.workspaceId, repositoryRead.workspaceId), eq(source.id, repositoryRead.sourceId)),
        )
        .where(
          and(
            eq(repositoryRead.workspaceId, workspaceId),
            eq(repositoryRead.candidateId, candidateId),
            ne(repositoryRead.status, 'pending'),
          ),
        )
        .orderBy(asc(repositoryRead.sourceId))
        .for('update');
    },
    async finish(read, checkedAt, checkMethod, from, signals) {
      const { workspaceId, sourceId, ...change } = read;
      const updated = await tx
        .update(repositoryRead)
        .set(change)
        .where(
          and(
            eq(repositoryRead.workspaceId, workspaceId),
            eq(repositoryRead.sourceId, sourceId),
            eq(repositoryRead.status, from),
          ),
        )
        .returning({ sourceId: repositoryRead.sourceId });
      if (updated.length === 0) return false;
      await replaceSignals(workspaceId, sourceId, signals);
      await tx
        .update(source)
        .set({ checkedAt, checkMethod })
        .where(and(eq(source.workspaceId, workspaceId), eq(source.id, sourceId)));
      return true;
    },
    async saveSkillSignals(read, signals) {
      const { workspaceId, sourceId, filesInspected, coverageGap } = read;
      const updated = await tx
        .update(repositoryRead)
        .set({ filesInspected, coverageGap })
        .where(
          and(
            eq(repositoryRead.workspaceId, workspaceId),
            eq(repositoryRead.sourceId, sourceId),
            eq(repositoryRead.coverageGap, 'rate_limited'),
          ),
        )
        .returning({ sourceId: repositoryRead.sourceId });
      if (updated.length) await replaceSignals(workspaceId, sourceId, signals);
    },
    async skillInputs(workspaceId, candidateId) {
      const reads = await tx
        .select({
          sourceId: repositoryRead.sourceId,
          filesInspected: repositoryRead.filesInspected,
          gap: repositoryRead.coverageGap,
        })
        .from(repositoryRead)
        .where(
          and(
            eq(repositoryRead.workspaceId, workspaceId),
            eq(repositoryRead.candidateId, candidateId),
            ne(repositoryRead.status, 'pending'),
          ),
        );
      if (!reads.length) return [];
      const signals = await tx
        .select()
        .from(repositorySkillSignal)
        .where(
          and(
            eq(repositorySkillSignal.workspaceId, workspaceId),
            inArray(
              repositorySkillSignal.sourceId,
              reads.map((r) => r.sourceId),
            ),
          ),
        )
        .orderBy(asc(repositorySkillSignal.position));
      return reads.map((r) => ({
        sourceId: r.sourceId,
        coverage: { filesInspected: r.filesInspected ?? 0, gap: r.gap },
        signals: signals
          .filter((s) => s.sourceId === r.sourceId)
          .map(({ skill, path, kind, weight, detail }) => ({ skill, path, kind, weight, detail })),
      }));
    },
    async replaceGrades(workspaceId, sourceId, rubricVersionId, grades) {
      await tx
        .delete(repositorySkillGrade)
        .where(
          and(
            eq(repositorySkillGrade.workspaceId, workspaceId),
            eq(repositorySkillGrade.sourceId, sourceId),
            eq(repositorySkillGrade.rubricVersionId, rubricVersionId),
          ),
        );
      if (grades.length)
        await tx
          .insert(repositorySkillGrade)
          .values(grades.map((g) => ({ ...g, workspaceId, sourceId, rubricVersionId })));
    },
    async listGrades(workspaceId, candidateId, rubricVersionId) {
      const rows = await tx
        .select({ grade: repositorySkillGrade, filesInspected: repositoryRead.filesInspected })
        .from(repositorySkillGrade)
        .innerJoin(
          repositoryRead,
          and(
            eq(repositoryRead.workspaceId, repositorySkillGrade.workspaceId),
            eq(repositoryRead.sourceId, repositorySkillGrade.sourceId),
          ),
        )
        .where(
          and(
            eq(repositorySkillGrade.workspaceId, workspaceId),
            eq(repositoryRead.candidateId, candidateId),
            eq(repositorySkillGrade.rubricVersionId, rubricVersionId),
          ),
        )
        .orderBy(
          asc(repositorySkillGrade.sourceId),
          asc(repositorySkillGrade.competencyId),
          asc(repositorySkillGrade.skill),
        );
      return rows.map(({ grade: { competencyId, skill, grade, reason, citations, sourceId }, filesInspected }) => ({
        repositorySourceId: sourceId,
        competencyId,
        skill,
        grade,
        reason,
        filesInspected: filesInspected ?? 0,
        citations: citations.map((c) => ({ repositorySourceId: sourceId, ...c })),
      }));
    },
    async insertItems(src, items, pulls) {
      if (src) await tx.insert(source).values(src);
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
    async pullRequestOrigins(workspaceId, candidateId) {
      const logins = await tx
        .selectDistinct({ login: repositoryRead.githubLogin })
        .from(repositoryRead)
        .where(
          and(
            eq(repositoryRead.workspaceId, workspaceId),
            eq(repositoryRead.candidateId, candidateId),
            isNotNull(repositoryRead.githubLogin),
          ),
        );
      const pulls = await tx
        .select({
          sourceId: item.sourceId,
          repository: mergedPullRequest.repository,
          mergedBy: mergedPullRequest.mergedBy,
          selfMerged: mergedPullRequest.selfMerged,
        })
        .from(mergedPullRequest)
        .innerJoin(
          item,
          and(eq(item.workspaceId, mergedPullRequest.workspaceId), eq(item.id, mergedPullRequest.itemId)),
        )
        .where(and(eq(mergedPullRequest.workspaceId, workspaceId), eq(mergedPullRequest.candidateId, candidateId)));
      return { logins: logins.flatMap((l) => (l.login ? [l.login.toLowerCase()] : [])), pulls };
    },
  };
}

import { PackError, type PackView } from '@credalent/decisions';
import { IntakeError } from '@credalent/intake';
import { ForbiddenError, type WorkspaceContext } from '@credalent/workspaces';
import { forbidden } from 'next/navigation';
import { z } from 'zod';
import { needRows } from '@/features/evidence-profile/domain/needs.ts';
import { getAssessment } from '@/server/assessment';
import { getIdentity } from '@/server/auth';
import { getDecisions } from '@/server/decisions';
import { getIntake } from '@/server/intake';
import { getApprovedRubricReads, getJobs } from '@/server/jobs';
import { getWorkspaces, inActiveWorkspace } from '@/server/workspace';
import type { PackLink, PackPage, PackPreview } from '../domain/pack.ts';

const isId = (id: string) => z.uuid().safeParse(id).success;

/**
 * One decision pack of the job (AIV-P2-010): its name, the job's title, when it was prepared and on which rubric
 * version, and its members in pack order with the scores snapshotted when they joined. The decisions module authorises
 * it (`pack.view`: admins, recruiters and hiring owners on the job); an interviewer gets the 403 page. 'notFound' for a
 * pack of another job or workspace, or a malformed id; null with no workspace.
 */
export const loadPack = (jobId: string, packId: string): Promise<PackPage | 'notFound' | null> =>
  withPack(jobId, packId, async (_ctx, _pack, page) => page);

/**
 * The pack as the hiring owner will see it (AIV-P1-116), with `loadPack`'s access and answers. Per member, from the
 * assessment they joined with: the competencies that meet the job's need and those short of it, and the cited
 * explanation (AIV-P1-033). Never a contact detail, CV or evidence file (AGENTS.md 1.9): none is read here. Sends
 * nothing and creates no file.
 */
// shortcut: one assessment read and one explanation per member, in turn, so the first view of a new snapshot waits for
// the model (cached after, AIV-P1-033); read them in parallel or stream them if a pilot pack is slow to open.
export const loadPackPreview = (jobId: string, packId: string): Promise<PackPreview | 'notFound' | null> =>
  withPack(jobId, packId, async (ctx, pack, page) => {
    const workspace = await getWorkspaces().getWorkspace(ctx);
    // Not authorised itself: `getPack` authorised this job for the member.
    const rubric = await getApprovedRubricReads().approvedRubric(ctx.tx, ctx.workspaceId, jobId);
    const names = new Map(
      rubric?.id === pack.rubricVersionId ? rubric.competencies.map((c) => [c.id, c.name] as const) : [],
    );
    const members: PackPreview['members'] = [];
    for (const [i, m] of pack.members.entries()) {
      const { candidateId, backedScore, upperBound } = m;
      const shown = { candidateId, name: page.members[i]?.name ?? null, backedScore, upperBound };
      const latest = await getAssessment().getLatestAssessment(ctx, m.candidateId, jobId);
      // SAFETY: only the assessment the member joined with, so a newer result's reasons never sit beside the pack's scores.
      if (latest?.id !== m.assessmentId) {
        members.push({ ...shown, summary: null });
        continue;
      }
      const rows = needRows(latest.competencies, names);
      const explanation = await getAssessment().explainRanking(ctx, m.candidateId, jobId);
      members.push({
        ...shown,
        summary: {
          strengths: rows.filter((r) => r.proven >= r.needed),
          risks: rows.filter((r) => r.proven < r.needed),
          explanation:
            explanation?.resultId === m.assessmentId
              ? { source: explanation.source, statements: explanation.statements }
              : null,
        },
      });
    }
    return { workspace: workspace?.name ?? '', name: page.name, job: page.job, preparedAt: page.preparedAt, members };
  });

/** Opens the job's pack for the member as `loadPack` describes, then `read`s from it in the same context. */
async function withPack<T>(
  jobId: string,
  packId: string,
  read: (ctx: WorkspaceContext, pack: PackView, page: PackPage) => Promise<T>,
): Promise<T | 'notFound' | null> {
  if (!isId(jobId) || !isId(packId)) return 'notFound';
  try {
    const result = await inActiveWorkspace(async (ctx): Promise<T | 'notFound'> => {
      const pack = await getDecisions().getPack(ctx, packId);
      // SAFETY: the job comes from the stored pack; a pack of another job under this job's address is not found.
      if (pack?.jobId !== jobId) return 'notFound';
      const header = await getJobs().getJobHeader(ctx, jobId);
      const applicants = await getIntake().listApplicationsForJob(ctx, jobId);
      const names = new Map(applicants.map((a) => [a.personId, a.displayName] as const));
      // The workspace members who added someone, shown as the job header shows its hiring owner.
      const adders = new Map(
        await Promise.all(
          [...new Set(pack.members.flatMap((m) => m.addedBy ?? []))].map(async (userId) => {
            const user = await getIdentity().getUser(userId);
            return [userId, user ? (user.displayName ?? user.email) : null] as const;
          }),
        ),
      );
      return read(ctx, pack, {
        jobId,
        packId,
        name: pack.name,
        job: header?.job.title ?? '',
        preparedAt: pack.preparedAt,
        rubricVersion: header?.approved?.id === pack.rubricVersionId ? header.approved.version : null,
        members: pack.members.map((m) => {
          const by = m.addedBy && adders.get(m.addedBy);
          return {
            candidateId: m.candidateId,
            name: names.get(m.candidateId) ?? null,
            backedScore: m.backedScore,
            upperBound: m.upperBound,
            added: by && m.addedAt ? { by, at: m.addedAt } : null,
          };
        }),
        others: new Set(applicants.map((a) => a.personId)).size - pack.members.length,
      });
    });
    return result ? result.value : null;
  } catch (error) {
    if (error instanceof ForbiddenError) forbidden();
    if (error instanceof IntakeError || error instanceof PackError) return 'notFound';
    throw error;
  }
}

/**
 * The job's undecided packs for its Decision tab (AIV-P2-010), newest first. Same access as `loadPack`; null with no
 * workspace, 'notFound' for a job the member cannot see or a malformed id.
 */
export async function loadJobPacks(jobId: string): Promise<PackLink[] | 'notFound' | null> {
  if (!isId(jobId)) return 'notFound';
  try {
    const result = await inActiveWorkspace(async (ctx) =>
      (await getDecisions().listPacks(ctx, jobId))
        .filter((p) => p.status === 'ready')
        .map((p) => ({ id: p.id, name: p.name, members: p.candidateIds.length })),
    );
    return result ? result.value : null;
  } catch (error) {
    if (error instanceof ForbiddenError) forbidden();
    if (error instanceof PackError) return 'notFound';
    throw error;
  }
}

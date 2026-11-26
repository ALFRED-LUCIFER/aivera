import { PackError, type PackView } from '@credalent/decisions';
import { IntakeError } from '@credalent/intake';
import { ForbiddenError, type WorkspaceContext } from '@credalent/workspaces';
import { forbidden } from 'next/navigation';
import { z } from 'zod';
import { needRows } from '@/features/evidence-profile/domain/needs.ts';
import { readSnapshotAsSystem } from '@/server/assessment';
import { getIdentity } from '@/server/auth';
import { getDecisions } from '@/server/decisions';
import { getIntake } from '@/server/intake';
import { getApprovedRubricReads, getJobs } from '@/server/jobs';
import { getWorkspaces, inActiveWorkspace } from '@/server/workspace';
import { byNeed, type CardSummary, type PackLink, type PackPage, type PackPreview } from '../domain/pack.ts';

const isId = (id: string) => z.uuid().safeParse(id).success;

/**
 * One decision pack of the job (AIV-P2-010): its name, the job's title, when it was prepared and on which rubric
 * version, what the role needs and its weights, and its members in pack order with the scores snapshotted when they
 * joined and their card text (AIV-P2-011). The decisions module authorises it (`pack.view`: admins, recruiters and
 * hiring owners on the job); an interviewer gets the 403 page. 'notFound' for a pack of another job or workspace, or a
 * malformed id; null with no workspace. No model is called: the card text was written when the member joined.
 */
export const loadPack = (jobId: string, packId: string): Promise<PackPage | 'notFound' | null> =>
  withPack(jobId, packId, async (_ctx, page) => page);

/**
 * The pack as the hiring owner will see it (AIV-P1-116), with `loadPack`'s access, answers and card text. Never a
 * contact detail, CV or evidence file (AGENTS.md 1.9): none is read here. Sends nothing and creates no file.
 */
export const loadPackPreview = (jobId: string, packId: string): Promise<PackPreview | 'notFound' | null> =>
  withPack(jobId, packId, async (ctx, page) => {
    const workspace = await getWorkspaces().getWorkspace(ctx);
    return {
      workspace: workspace?.name ?? '',
      name: page.name,
      job: page.job,
      preparedAt: page.preparedAt,
      members: page.members.map(({ candidateId, name, backedScore, upperBound, summary }) => ({
        candidateId,
        name,
        backedScore,
        upperBound,
        summary,
      })),
    };
  });

/**
 * A member's card text: the stored summary, or while none is stored "Preparing summary". An unavailable one carries the
 * competencies meeting the job's need and those short of it, from the assessment the member joined with.
 */
async function cardOf(
  ctx: WorkspaceContext,
  member: PackView['members'][number],
  stored: PackView['summaries'][number] | undefined,
  names: ReadonlyMap<string, string>,
): Promise<CardSummary> {
  if (!stored) return { status: 'preparing' };
  if (stored.summary) return { status: 'ready', summary: stored.summary };
  // The snapshot the member joined with, never a newer result. Not authorised itself: `getPack` authorised this job.
  const snapshot = names.size ? await readSnapshotAsSystem(ctx, member.assessmentId) : null;
  const rows = snapshot ? byNeed(needRows(snapshot.competencies, names)) : null;
  return { status: 'unavailable', strengths: rows?.strengths ?? [], risks: rows?.risks ?? [] };
}

/** Opens the job's pack for the member as `loadPack` describes, then `read`s from it in the same context. */
async function withPack<T>(
  jobId: string,
  packId: string,
  read: (ctx: WorkspaceContext, page: PackPage) => Promise<T>,
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
      // Every member's snapshot is on the pack's rubric version; once another is approved its competencies have no names.
      // Not authorised itself: `getPack` authorised this job for the member.
      const rubric = await getApprovedRubricReads().approvedRubric(ctx.tx, ctx.workspaceId, jobId);
      const onPack = rubric?.id === pack.rubricVersionId && header?.approved?.id === rubric.id ? rubric : null;
      const competencies = new Map(onPack?.competencies.map((c) => [c.id, c.name] as const) ?? []);
      const summaries = new Map(pack.summaries.map((s) => [s.candidateId, s] as const));
      const members: PackPage['members'] = [];
      for (const m of pack.members) {
        const by = m.addedBy && adders.get(m.addedBy);
        members.push({
          candidateId: m.candidateId,
          name: names.get(m.candidateId) ?? null,
          backedScore: m.backedScore,
          upperBound: m.upperBound,
          added: by && m.addedAt ? { by, at: m.addedAt } : null,
          summary: await cardOf(ctx, m, summaries.get(m.candidateId), competencies),
        });
      }
      return read(ctx, {
        jobId,
        packId,
        name: pack.name,
        job: header?.job.title ?? '',
        preparedAt: pack.preparedAt,
        rubricVersion: header?.approved?.id === pack.rubricVersionId ? header.approved.version : null,
        role: onPack && {
          successStatement: header?.approved?.successStatement ?? '',
          competencies: onPack.competencies.map(({ name, weightPercent }) => ({ name, weightPercent })),
        },
        members,
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

import { PackError } from '@credalent/decisions';
import { IntakeError } from '@credalent/intake';
import { ForbiddenError } from '@credalent/workspaces';
import { forbidden } from 'next/navigation';
import { z } from 'zod';
import { getDecisions } from '@/server/decisions';
import { getIntake } from '@/server/intake';
import { getJobs } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import type { PackLink, PackPage } from '../domain/pack.ts';

const isId = (id: string) => z.uuid().safeParse(id).success;

/**
 * One decision pack of the job (AIV-P2-010): its name, the job's title, when it was prepared and on which rubric
 * version, and its members in pack order with the scores snapshotted when they joined. The decisions module authorises
 * it (`pack.view`: admins, recruiters and hiring owners on the job); an interviewer gets the 403 page. 'notFound' for a
 * pack of another job or workspace, or a malformed id; null with no workspace.
 */
export async function loadPack(jobId: string, packId: string): Promise<PackPage | 'notFound' | null> {
  if (!isId(jobId) || !isId(packId)) return 'notFound';
  try {
    const result = await inActiveWorkspace(async (ctx): Promise<PackPage | 'notFound'> => {
      const pack = await getDecisions().getPack(ctx, packId);
      // SAFETY: the job comes from the stored pack; a pack of another job under this job's address is not found.
      if (pack?.jobId !== jobId) return 'notFound';
      const header = await getJobs().getJobHeader(ctx, jobId);
      const applicants = await getIntake().listApplicationsForJob(ctx, jobId);
      const names = new Map(applicants.map((a) => [a.personId, a.displayName] as const));
      return {
        jobId,
        name: pack.name,
        job: header?.job.title ?? '',
        preparedAt: pack.preparedAt,
        rubricVersion: header?.approved?.id === pack.rubricVersionId ? header.approved.version : null,
        members: pack.members.map((m) => ({
          candidateId: m.candidateId,
          name: names.get(m.candidateId) ?? null,
          backedScore: m.backedScore,
          upperBound: m.upperBound,
        })),
        others: new Set(applicants.map((a) => a.personId)).size - pack.members.length,
      };
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

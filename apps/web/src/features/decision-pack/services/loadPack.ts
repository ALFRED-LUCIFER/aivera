import { PackError } from '@credalent/decisions';
import { IntakeError } from '@credalent/intake';
import { ForbiddenError } from '@credalent/workspaces';
import { forbidden } from 'next/navigation';
import { z } from 'zod';
import { getDecisions } from '@/server/decisions';
import { getIntake } from '@/server/intake';
import { getJobs } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import type { PackPage } from '../domain/pack.ts';

/**
 * One decision pack of the job (AIV-P2-010): its name, the job's title and its members in pack order with the scores
 * snapshotted when they joined. The decisions module authorises it (`pack.view`: admins, recruiters and hiring owners
 * on the job); an interviewer gets the 403 page. 'notFound' for a pack of another job or workspace, or a malformed id;
 * null with no workspace.
 */
export async function loadPack(jobId: string, packId: string): Promise<PackPage | 'notFound' | null> {
  if (!z.uuid().safeParse(jobId).success || !z.uuid().safeParse(packId).success) return 'notFound';
  try {
    const result = await inActiveWorkspace(async (ctx): Promise<PackPage | 'notFound'> => {
      const pack = await getDecisions().getPack(ctx, packId);
      // The job comes from the stored pack: the route's job must be it.
      if (pack?.jobId !== jobId) return 'notFound';
      const job = await getJobs().getJob(ctx, jobId);
      const names = new Map(
        (await getIntake().listApplicationsForJob(ctx, jobId)).map((a) => [a.personId, a.displayName] as const),
      );
      return {
        name: pack.name,
        job: job?.title ?? '',
        members: pack.members.map((m) => ({
          candidateId: m.candidateId,
          name: names.get(m.candidateId) ?? null,
          backedScore: m.backedScore,
          upperBound: m.upperBound,
        })),
      };
    });
    return result ? result.value : null;
  } catch (error) {
    if (error instanceof ForbiddenError) forbidden();
    if (error instanceof IntakeError || error instanceof PackError) return 'notFound';
    throw error;
  }
}

'use server';

import { PackError } from '@credalent/decisions';
import { IntakeError } from '@credalent/intake';
import { log } from '@credalent/observability';
import { ForbiddenError } from '@credalent/workspaces';
import { revalidatePath } from 'next/cache';
import { forbidden, notFound, unstable_rethrow } from 'next/navigation';
import { getDecisions } from '@/server/decisions';
import { getIntake } from '@/server/intake';
import { inActiveWorkspace } from '@/server/workspace';
import { addToPackSchema, type AddToPackResult } from '../domain/pack.ts';

/**
 * Runs a confirmed "Add to decision pack" in the active workspace (AIV-P2-010): the selected applications of this job
 * become members of a new pack or of an existing one, each with their assessment snapshot. The decisions module
 * authorises it (admins and recruiters on the job, `pack.prepare`); anyone else gets the 403 page, and another
 * workspace's job is not found. It contacts nobody and changes no stage. Logs ids, counts and error names only.
 */
export async function addToDecisionPack(input: unknown): Promise<AddToPackResult> {
  const parsed = addToPackSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { jobId, applicationIds, pack } = parsed.data;
  let result;
  try {
    result = await inActiveWorkspace(async (ctx) => {
      // SAFETY: members are this job's applicants only; any other application refuses the whole addition.
      const personOf = new Map(
        (await getIntake().listApplicationsForJob(ctx, jobId)).map((a) => [a.applicationId, a.personId]),
      );
      const members = applicationIds.map((id) => personOf.get(id));
      if (members.some((m) => m === undefined)) return 'notOnJob' as const;
      const candidates = members.flatMap((candidateId) => (candidateId ? [{ candidateId }] : []));
      if ('packId' in pack) {
        const { added } = await getDecisions().addMembers(ctx, pack.packId, candidates);
        return { packId: pack.packId, added };
      }
      const { packId } = await getDecisions().createPack(ctx, { jobId, name: pack.name, members: candidates });
      return { packId, added: new Set(candidates.map((c) => c.candidateId)).size };
    });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ForbiddenError) forbidden();
    if (error instanceof IntakeError || (error instanceof PackError && error.code === 'job_not_found')) notFound();
    if (error instanceof PackError) return { ok: false, error: 'refused' };
    log.error(
      { area: 'candidates', 'error.type': error instanceof Error ? error.name : 'unknown' },
      'add to decision pack failed',
    );
    return { ok: false, error: 'failed' };
  }
  if (!result) forbidden();
  if (result.value === 'notOnJob') return { ok: false, error: 'notOnJob' };
  log.info({ area: 'candidates', jobId, packId: result.value.packId }, 'added to decision pack');
  revalidatePath('/app', 'layout');
  return { ok: true, ...result.value };
}

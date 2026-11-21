import { IntakeError, type ApplicationListItem } from '@credalent/intake';
import { log } from '@credalent/observability';
import { z } from 'zod';
import { getIntake } from '@/server/intake';
import { inActiveWorkspace } from '@/server/workspace';

/**
 * The Candidates tab's applicants (AIV-P1-086) through `listApplicationsForJob`, which checks `candidate.view` and the
 * member's job scope. Null when the job is not visible or there is no workspace. The log line carries ids and a count.
 */
export async function loadApplicants(jobId: string): Promise<ApplicationListItem[] | null> {
  // The layout runs alongside this page, so a malformed id must not reach the database from here either.
  if (!z.uuid().safeParse(jobId).success) return null;
  try {
    const result = await inActiveWorkspace((ctx) => getIntake().listApplicationsForJob(ctx, jobId));
    if (!result) return null;
    log.info({ area: 'candidates', jobId, 'credalent.intake.applications': result.value.length }, 'applicants listed');
    return result.value;
  } catch (error) {
    if (error instanceof IntakeError) return null;
    throw error;
  }
}

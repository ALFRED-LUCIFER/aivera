import type { IntakeContract, ReceiveApplicationInput } from '@credalent/intake';
import type { WorkspaceContext } from '@credalent/workspaces';

/** One arrival added under a confirmed batch, as "Add applicants" files it (AIV-P1-104): the worker reads only those. */
export async function receiveConfirmed(
  intake: Pick<IntakeContract, 'receiveBatch'>,
  ctx: WorkspaceContext,
  { jobId, ...arrival }: ReceiveApplicationInput,
) {
  const { applications } = await intake.receiveBatch(ctx, {
    jobId,
    rightToProcessConfirmed: true,
    wordingKey: 'import.rightToProcess.v1',
    arrivals: [arrival],
  });
  const [first] = applications;
  if (!first) throw new Error('The batch added nobody.');
  return first;
}

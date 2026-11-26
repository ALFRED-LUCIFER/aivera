'use server';

import { PackError } from '@credalent/decisions';
import { log } from '@credalent/observability';
import { ForbiddenError } from '@credalent/workspaces';
import { revalidatePath } from 'next/cache';
import { forbidden, notFound, unstable_rethrow } from 'next/navigation';
import { getDecisions } from '@/server/decisions';
import { inActiveWorkspace } from '@/server/workspace';
import { recordDecisionsSchema, type RecordDecisionsResult } from '../domain/pack.ts';

/**
 * Records the hiring owner's confirmed decisions on a pack (AIV-P2-012) through the decisions contract, in one
 * transaction: every decision with the reason, the pack `decided`, one `DecisionsRecorded.v1` (intake's consumer moves
 * the stages) and one audit entry per decision, last. Only the hiring owner named on the pack's job may: the module
 * refuses anyone else with `ForbiddenError`, so a direct request gets the 403 page. A pack the member cannot see is not
 * found. It contacts no candidate (AGENTS.md 1.5). Logs ids and error names only, never the reason.
 */
export async function recordDecisions(input: unknown): Promise<RecordDecisionsResult> {
  const parsed = recordDecisionsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { packId, decisions, reason } = parsed.data;
  let result;
  try {
    result = await inActiveWorkspace((ctx) =>
      getDecisions().recordDecisions(ctx, { packId, decisions: decisions.map((d) => ({ ...d, note: reason })) }),
    );
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ForbiddenError) forbidden();
    if (error instanceof PackError) {
      if (error.code === 'pack_not_found') notFound();
      return { ok: false, error: error.code === 'pack_decided' ? 'decided' : 'invalid' };
    }
    log.error(
      { area: 'decisions', 'error.type': error instanceof Error ? error.name : 'unknown' },
      'record decisions failed',
    );
    return { ok: false, error: 'failed' };
  }
  if (!result) forbidden();
  log.info({ area: 'decisions', packId, count: decisions.length }, 'decisions recorded');
  revalidatePath('/app', 'layout');
  return { ok: true, decidedAt: result.value.decidedAt };
}

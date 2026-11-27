'use server';

import { log } from '@credalent/observability';
import { forbidden, notFound, unstable_rethrow } from 'next/navigation';
import { evidenceAnchor, profileHref } from '@/features/evidence-profile/domain/profile.ts';
import { getAssessment } from '@/server/assessment';
import { getIntake } from '@/server/intake';
import { inActiveWorkspace } from '@/server/workspace';
import { tradeoffsInput, type TradeoffsView } from '../domain/compare.ts';

/**
 * "Show the trade-offs" on the comparison page (AIV-P1-047): one model call for the compared candidates, on demand,
 * so the workspace's AI allowance is spent only when a person asks. The assessment module authorises the job for every
 * candidate (`candidate.view`; anyone else gets the 403 page) before anything is read or asked. Candidates the job does
 * not have, or a malformed id, are not found. The statements are for a person to read: nothing here changes a score,
 * stage or rank (AGENTS.md 1.5).
 */
export async function writeTradeoffs(input: unknown): Promise<TradeoffsView> {
  const parsed = tradeoffsInput.safeParse(input);
  if (!parsed.success) notFound();
  const { jobId, candidateIds } = parsed.data;
  try {
    const result = await inActiveWorkspace(async (ctx): Promise<TradeoffsView | null> => {
      const tradeoffs = await getAssessment().compareTradeoffs(ctx, jobId, candidateIds);
      if (!tradeoffs || tradeoffs.status === 'unavailable') return tradeoffs;
      // Read only after the assessment module authorised the job for every candidate.
      const names = new Map(
        (await getIntake().listApplicationsForJob(ctx, jobId)).map((a) => [a.personId, a.displayName]),
      );
      return {
        status: 'written',
        candidates: tradeoffs.candidates.map(({ candidateId, statements }) => ({
          candidateId,
          name: names.get(candidateId) ?? null,
          profileHref: profileHref(candidateId, jobId),
          statements: statements.map(({ text, citations }) => ({
            text,
            ofSnapshot: citations.every((c) => c.itemId === null),
            // A citation with no item is the snapshot's own facts, which the grid above already shows.
            citations: citations.flatMap(({ itemId, quote, label }, i) =>
              itemId
                ? [
                    {
                      key: `${itemId}:${i}`,
                      quote,
                      label,
                      href: `${profileHref(candidateId, jobId)}#${evidenceAnchor(itemId)}`,
                    },
                  ]
                : [],
            ),
          })),
        })),
      };
    });
    if (!result) forbidden();
    if (!result.value) notFound();
    return result.value;
  } catch (error) {
    unstable_rethrow(error);
    // The name only: an error's detail could repeat a statement or an excerpt (AGENTS.md 1.2).
    log.warn(
      { area: 'compare', 'error.type': error instanceof Error ? error.name : 'unknown' },
      'compare trade-offs failed',
    );
    return { status: 'unavailable' };
  }
}

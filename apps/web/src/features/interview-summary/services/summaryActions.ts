'use server';

import { InterviewError, summaryTextSchema, type SummaryPreview } from '@credalent/interviews';
import { log } from '@credalent/observability';
import type { WorkspaceContext } from '@credalent/workspaces';
import { forbidden, notFound, unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { getInterviews } from '@/server/interviews';
import { inActiveWorkspace } from '@/server/workspace';
import {
  applyInput,
  declineInput,
  errorKey,
  previewInput,
  submitInput,
  type SummaryErrorKey,
  type SummaryOutcome,
} from '../domain/summary.ts';
import { panelOf } from './loadSummary.ts';

// The meeting-summary panel's actions (AIV-P1-115). The interviews module authorises each on the stored interview's
// job: its interviewer, or an admin or recruiter; anyone else gets the 403 page and nothing is stored or applied. An
// interview or summary the workspace does not have, or a malformed input, is not found.

const NOT_FOUND = ['interview_not_found', 'summary_not_found'];

/** Runs `fn` in the member's workspace; a refusal the panel has words for comes back as its key. */
async function run<T>(
  what: string,
  fn: (ctx: WorkspaceContext) => Promise<T>,
): Promise<T | { error: SummaryErrorKey }> {
  try {
    const result = await inActiveWorkspace(fn);
    if (!result) forbidden();
    return result.value;
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof InterviewError) {
      if (NOT_FOUND.includes(error.code)) notFound();
      return { error: errorKey(error.code) };
    }
    // The name only: an error's detail could repeat the summary or a reason (AGENTS.md 1.2).
    log.warn(
      { area: 'interview-summary', 'error.type': error instanceof Error ? error.name : 'unknown' },
      `${what} failed`,
    );
    return { error: 'failed' };
  }
}

/** The panel after an action, read in the same transaction so the browser shows what was stored. */
const panelAfter = async (ctx: WorkspaceContext, interviewId: string): Promise<SummaryOutcome> => {
  const panel = await panelOf(ctx, interviewId);
  return panel ? { panel } : { error: 'failed' };
};

/**
 * Stores the pasted summary and queues its analysis on the worker. It changes no score, evidence or stage: the worker
 * only proposes, and nothing applies until a person confirms (AGENTS.md 1.5).
 */
export async function submitSummary(input: unknown): Promise<SummaryOutcome> {
  const parsed = submitInput.safeParse(input);
  if (!parsed.success) notFound();
  const { interviewId, text } = parsed.data;
  const checked = summaryTextSchema.safeParse(text);
  if (!checked.success) return { error: errorKey(checked.error.issues[0]?.message ?? '') };
  return run('submit meeting summary', async (ctx) => {
    await getInterviews().submitMeetingSummary(ctx, interviewId, checked.data);
    return panelAfter(ctx, interviewId);
  });
}

/** The panel as it is now: the page asks again while the worker analyses. Null for a member who may not see it. */
export async function refreshSummary(input: unknown): Promise<SummaryOutcome | null> {
  const interviewId = z.uuid().safeParse(input);
  if (!interviewId.success) notFound();
  return run('refresh meeting summary', async (ctx) => {
    const panel = await panelOf(ctx, interviewId.data);
    return panel && { panel };
  });
}

/** The backed score before and after for the ticked changes. Writes nothing. */
export async function previewSummary(
  input: unknown,
): Promise<{ preview: SummaryPreview } | { error: SummaryErrorKey }> {
  const parsed = previewInput.safeParse(input);
  if (!parsed.success) notFound();
  const { summaryId, competencyIds } = parsed.data;
  return run('preview meeting summary', async (ctx) => ({
    preview: await getInterviews().previewSummaryProposals(ctx, summaryId, competencyIds),
  }));
}

/** Applies the changes the person confirmed, each with their reason: the only action here that changes a score. */
export async function applySummary(input: unknown): Promise<SummaryOutcome> {
  const parsed = applyInput.safeParse(input);
  if (!parsed.success) notFound();
  const { interviewId, summaryId, previewId, changes } = parsed.data;
  return run('apply meeting summary', async (ctx) => {
    await getInterviews()
      .applySummaryProposals(ctx, summaryId, { previewId, changes })
      .catch((error: unknown) => {
        // Already decided (a retry after the apply committed, or a decline in another tab): show the panel as stored.
        // Thrown before anything is written, so the transaction is still good to read in.
        if (!(error instanceof InterviewError && error.code === 'summary_decided')) throw error;
      });
    return panelAfter(ctx, interviewId);
  });
}

/** Declines every proposal: nothing is applied and the summary stays on the interview. */
export async function declineSummary(input: unknown): Promise<SummaryOutcome> {
  const parsed = declineInput.safeParse(input);
  if (!parsed.success) notFound();
  const { interviewId, summaryId } = parsed.data;
  return run('decline meeting summary', async (ctx) => {
    await getInterviews().declineSummaryProposals(ctx, summaryId);
    return panelAfter(ctx, interviewId);
  });
}

import type { WorkspaceContext } from '@credalent/workspaces';
import { z } from 'zod';
import { getInterviews } from '@/server/interviews';
import { getApprovedRubricReads } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import { lowers, type SummaryPanel } from '../domain/summary.ts';

/**
 * The meeting-summary panel for one interview, in the member's transaction (AIV-P1-115). Null for a member who may
 * not act on the interview's summary: the interviews module decides (its interviewer, or an admin or recruiter, on a
 * job they can reach). Stored reads and the assessment's own preview only: no model is called and nothing is written.
 */
export async function panelOf(ctx: WorkspaceContext, interviewId: string): Promise<SummaryPanel | null> {
  const read = await getInterviews().getMeetingSummary(ctx, interviewId);
  if (!read) return null;
  if (!read.summary) return { interviewId, summary: null };
  // Not authorised itself: `getMeetingSummary` above authorised this interview's job for the member.
  const interview = await getInterviews().getInterview(ctx, interviewId);
  const rubric = interview && (await getApprovedRubricReads().approvedRubric(ctx.tx, ctx.workspaceId, interview.jobId));
  const names = new Map(rubric?.competencies.map((c) => [c.id, c.name]));
  const { summaryId, status, unusual, proposals, preview, previewUnavailable } = read.summary;
  return {
    interviewId,
    summary: {
      summaryId,
      status,
      unusual,
      preview,
      previewUnavailable,
      // The interview's order; a competency the approved rubric no longer names is left out, as on the scorecard.
      proposals: (interview?.competencyIds ?? []).flatMap((id) => {
        const proposal = proposals.find((p) => p.competencyId === id);
        const name = names.get(id);
        if (!proposal || name === undefined) return [];
        const { competencyId, finding, excerpt, reason, change, alreadyChanged } = proposal;
        const shown = change && { from: change.from.strength, to: change.to.strength };
        return {
          competencyId,
          name,
          finding,
          excerpt,
          reason,
          change: shown,
          alreadyChanged,
          lowers: lowers(finding, shown),
        };
      }),
    },
  };
}

/** The panel for the interview page; null with no workspace, a malformed id, or a member who may not act on it. */
export async function loadSummary(interviewId: string): Promise<SummaryPanel | null> {
  if (!z.uuid().safeParse(interviewId).success) return null;
  const result = await inActiveWorkspace((ctx) => panelOf(ctx, interviewId));
  return result && result.value;
}

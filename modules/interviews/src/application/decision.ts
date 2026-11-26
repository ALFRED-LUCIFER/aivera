import type { WorkspaceContext } from '@credalent/workspaces';
import { InterviewError } from '../domain/interview.ts';
import type { DecisionPorts } from './summary.ts';

// The assessment refuses a preview or an apply with its own error; this module has no dependency on its package.
export const refusedByAssessment = (error: unknown) => error instanceof Error && error.name === 'ScoreChangeError';

/**
 * How a person's confirmed word on an interview ends, a meeting summary's (AIV-P1-115) or a scorecard's (AIV-P2-006):
 * its write-up recorded as evidence (none to record, nothing recorded), then the previewed ratings applied through
 * the assessment's audited command, whose snapshot and audit entries are the transaction's last statements (AGENTS.md
 * 3.6). The snapshot it leaves; the assessment's refusal is "Preview the change again".
 */
export async function recordAndApply(
  ports: Pick<DecisionPorts, 'recordSummaryEvidence' | 'applyScoreChange'>,
  ctx: WorkspaceContext,
  writeUp: Parameters<DecisionPorts['recordSummaryEvidence']>[1],
  change: Omit<Parameters<DecisionPorts['applyScoreChange']>[1], 'writeUpItemIds'>,
): Promise<{ id: string }> {
  const { itemIds } = writeUp.items.length > 0 ? await ports.recordSummaryEvidence(ctx, writeUp) : { itemIds: [] };
  try {
    return await ports.applyScoreChange(ctx, { ...change, writeUpItemIds: itemIds });
  } catch (error) {
    if (refusedByAssessment(error)) throw new InterviewError('preview_changed');
    throw error;
  }
}

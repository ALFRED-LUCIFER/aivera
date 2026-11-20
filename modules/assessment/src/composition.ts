// Builds the assessment module for an app (ADR-002: only apps import this).
import type { AuditContract } from '@credalent/audit';
import { uuidv7 } from '@credalent/db/uuidv7';
import type { WorkspacesContract } from '@credalent/workspaces';
import { assessmentUseCases } from './application/assessment.ts';
import type { AssessmentContract } from './contracts/index.ts';
import { assessmentStore } from './infrastructure/repository.ts';

/** `now` is the injected clock (AGENTS.md 3.9); tests pass a fixed one. */
export function createAssessment(
  workspaces: Pick<WorkspacesContract, 'authorize'>,
  audit: Pick<AuditContract, 'record'>,
  now: () => Date = () => new Date(),
): AssessmentContract {
  return assessmentUseCases({
    storeFor: assessmentStore,
    authorize: (ctx, action) => workspaces.authorize(ctx, action),
    auditScoreChange: (ctx, change) =>
      audit.record(
        { tx: ctx.tx, workspaceId: ctx.workspaceId, actor: { type: 'user', id: ctx.userId } },
        {
          action: 'score.changed',
          subject: { type: 'candidate', id: change.candidateId },
          note: 'Assessed from the evidence against the approved rubric version.',
          ...(change.before && { before: change.before }),
          after: change.after,
        },
      ),
    newId: () => uuidv7(),
    now,
  });
}

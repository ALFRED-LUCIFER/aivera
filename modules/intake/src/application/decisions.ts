import type { Tx } from '@credalent/db';
import { stageAfter, type RecordedDecision, type Stage } from '../domain/application.ts';
import type { IntakeStore } from './applications.ts';

/** One application moved by a recorded decision, as audited (`application.stage_changed`). */
export type DecisionStageChange = {
  applicationId: string;
  jobId: string;
  packId: string;
  from: Stage;
  to: Stage;
  /** The hiring owner who recorded the decision: the audit entry's actor. */
  decidedBy: string;
  /** The decision's reason: the audit entry's note. */
  note: string;
};

export type DecisionStagePorts = {
  storeFor(tx: Tx): IntakeStore;
  /** The pack's recorded decisions (the decisions composition's `readDecisionsAsSystem`), wired by the worker. */
  decisionsOf(tx: Tx, workspaceId: string, packId: string): Promise<RecordedDecision[]>;
  /** Appends `application.stage_changed` to the audit log in `tx`: the last statements before commit (AGENTS.md 3.6). */
  auditStageChanged(tx: Tx, workspaceId: string, change: DecisionStageChange): Promise<void>;
};

/**
 * The worker job for `DecisionsRecorded.v1` (AIV-P2-012): moves each decided candidate's application on the pack's job
 * to the stage their decision leads to (`stageAfter`), then audits each move with the hiring owner as actor. A hold, an
 * application already at that stage, a withdrawn one (a decision never brings a candidate back) or none at all is left
 * alone, so a second run changes nothing. It contacts nobody (AGENTS.md 1.5).
 */
export async function applyDecisions(
  ports: DecisionStagePorts,
  tx: Tx,
  workspaceId: string,
  { packId, jobId }: { packId: string; jobId: string },
) {
  const store = ports.storeFor(tx);
  const changes: DecisionStageChange[] = [];
  for (const { candidateId, decision, decidedBy, note } of await ports.decisionsOf(tx, workspaceId, packId)) {
    const to = stageAfter(decision);
    const application = to && (await store.findForPersonAndJob(workspaceId, candidateId, jobId));
    if (!to || !application || application.stage === to || application.stage === 'withdrawn') continue;
    // Conditional on the stage read, so a person's concurrent move wins and is not overwritten.
    if (!(await store.moveStage(workspaceId, application.id, application.stage, to))) continue;
    changes.push({ applicationId: application.id, jobId, packId, from: application.stage, to, decidedBy, note });
  }
  for (const change of changes) await ports.auditStageChanged(tx, workspaceId, change);
}

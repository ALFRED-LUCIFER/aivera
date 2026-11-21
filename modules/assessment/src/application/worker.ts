import type { Tx } from '@credalent/db';
import type { EvidenceItemView } from '@credalent/evidence';
import type { RubricCompetency } from '../domain/assess.ts';
import { recordAssessment, type Ports } from './assessment.ts';

/** The worker's reads, in the consumer's workspace-scoped transaction; the worker's composition root wires them. */
export type WorkerPorts = Pick<Ports, 'storeFor' | 'auditScoreChange' | 'newId' | 'now'> & {
  /** The job's approved rubric version (the jobs module's `createApprovedRubricReads`); null when none is approved. */
  approvedRubric(
    tx: Tx,
    workspaceId: string,
    jobId: string,
  ): Promise<{ id: string; competencies: readonly RubricCompetency[] } | null>;
  /** The candidate's evidence for the job (the evidence module's `readEvidenceForJobAsSystem`). */
  evidenceForJob(tx: Tx, workspaceId: string, candidateId: string, jobId: string): Promise<EvidenceItemView[]>;
};

/**
 * Assesses each candidate for the job against its approved rubric version, as the system (AIV-P1-031). With no
 * approved version nothing is assessed: a draft or a version sent for approval never scores anyone. `mappedVersionId`
 * is the version an evidence mapping was made against: when another version is approved since, the mapping for that
 * one follows, so this stale one is skipped rather than scored against competencies it never saw.
 */
export async function assessForJob(
  ports: WorkerPorts,
  tx: Tx,
  workspaceId: string,
  jobId: string,
  candidateIds: readonly string[],
  mappedVersionId?: string,
): Promise<void> {
  const approved = await ports.approvedRubric(tx, workspaceId, jobId);
  if (!approved || (mappedVersionId !== undefined && mappedVersionId !== approved.id)) return;
  const rubric = { versionId: approved.id, competencies: approved.competencies };
  // shortcut: every candidate of a job in one transaction (RubricApproved.v1 without evidence mapping): if it holds the
  // candidates' locks past lock_timeout (10 s), other messages for them fail with 55P03 and retry, and one failure rolls
  // back the whole job; fan out one message per candidate, as evidence mapping does, if pilot jobs show either.
  for (const candidateId of candidateIds) {
    // Locked before the evidence is read, so a run that read older evidence can never store after a newer one.
    await ports.storeFor(tx).lock(workspaceId, candidateId, jobId);
    const evidence = await ports.evidenceForJob(tx, workspaceId, candidateId, jobId);
    // shortcut: no `assessment.changed` event: nothing consumes one yet; its first consumer, the score history on the
    // profile (AIV-P1-046), publishes it here with the before and after backed score when recordAssessment is `changed`.
    await recordAssessment(ports, { tx, workspaceId, userId: null }, { candidateId, jobId, rubric, evidence });
  }
}

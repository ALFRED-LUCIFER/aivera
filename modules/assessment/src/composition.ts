// Builds the assessment module for an app (ADR-002: only apps import this).
import type { AuditContract } from '@credalent/audit';
import type { Tx } from '@credalent/db';
import type { Handler } from '@credalent/db/consumer';
import { uuidv7 } from '@credalent/db/uuidv7';
import { ContradictionResolvedV1, EvidenceMappedV1, EvidenceRecordedV1 } from '@credalent/evidence';
import { RubricApprovedV1, type JobsContract } from '@credalent/jobs';
import type { WorkspacesContract } from '@credalent/workspaces';
import { assessmentUseCases, type Ports } from './application/assessment.ts';
import { explainUseCases, type ExplainPorts } from './application/explain.ts';
import { questionUseCases, type QuestionPorts } from './application/questions.ts';
import { scoreChangeUseCases, type ScoreChangePorts } from './application/scoreChange.ts';
import { assessForJob, type WorkerPorts } from './application/worker.ts';
import type { AssessmentContract } from './contracts/index.ts';
import { assessmentStore, explanationStore, questionStore } from './infrastructure/repository.ts';
import { inbox } from './infrastructure/schema.ts';

/** The queue the relay sends evidence and rubric changes to for scoring (infra/modules/messaging.bicep). */
export const ASSESSMENT_QUEUE = 'assessment';

const auditWith =
  (audit: Pick<AuditContract, 'record'>): Ports['auditScoreChange'] =>
  ({ tx, workspaceId, userId }, change) =>
    audit.record(
      { tx, workspaceId, actor: userId === null ? { type: 'system' } : { type: 'user', id: userId } },
      {
        action: 'score.changed',
        subject: { type: 'candidate', id: change.candidateId },
        note: change.note ?? 'Assessed from the evidence against the approved rubric version.',
        ...(change.before && { before: change.before }),
        after: change.after,
      },
    );

const notWired = async (): Promise<never> => {
  throw new Error('Interview-based score changes are not wired in this app');
};

const questionsNotWired = async (): Promise<never> => {
  throw new Error('Suggested interview questions are not wired in this app');
};

/** `now` is the injected clock (AGENTS.md 3.9); tests pass a fixed one. */
export function createAssessment(
  workspaces: Pick<WorkspacesContract, 'authorize'>,
  audit: Pick<AuditContract, 'record'>,
  jobs: Pick<JobsContract, 'getJob' | 'getApprovedRubric'>,
  now: () => Date = () => new Date(),
  // Fails closed: with no resolver a hiring owner or interviewer reads no assessment (intake's resolver, AIV-P1-091).
  candidateJob: Ports['candidateJob'] = async () => null,
  // Intake's candidatesForJob, so the ranking lists only current applicants (AIV-P1-018).
  applicants?: Ports['applicants'],
  // The model, rubric names, evidence and identifiers behind `explainRanking` (AIV-P1-033); without them it throws.
  explain?: Pick<ExplainPorts, 'ai' | 'approvedRubric' | 'evidence' | 'identifiersOf'>,
  // The evidence read and the interview lookup behind interview-based score changes (AIV-P1-117); without them they throw.
  scoreChange?: Pick<ScoreChangePorts, 'evidenceForJob' | 'interviewOf'>,
  // The model, rubric meanings, evidence, identifiers, mapping checks and job behind the suggested questions (AIV-P1-113); without them they throw.
  questions?: Pick<QuestionPorts, 'ai' | 'approvedRubric' | 'evidence' | 'identifiersOf' | 'changes' | 'jobOf'>,
): AssessmentContract {
  const base: Ports = {
    storeFor: assessmentStore,
    authorize: (ctx, action, resource) => workspaces.authorize(ctx, action, resource),
    candidateJob,
    ...(applicants && { applicants }),
    rankingJob: async (ctx, jobId) => {
      const job = await jobs.getJob(ctx, jobId);
      if (!job) return null;
      const approved = await jobs.getApprovedRubric(ctx, jobId);
      return { resource: { jobId: job.id, clientId: job.clientId }, approvedVersionId: approved?.id ?? null };
    },
    auditScoreChange: auditWith(audit),
    newId: () => uuidv7(),
    now,
  };
  return {
    ...assessmentUseCases(base),
    explainRanking: explain
      ? explainUseCases({ ...base, ...explain, explanationsFor: explanationStore }).explainRanking
      : async () => {
          throw new Error('Ranking explanations are not wired in this app');
        },
    ...(scoreChange
      ? scoreChangeUseCases({ ...base, ...scoreChange })
      : { previewScoreChange: notWired, applyScoreChange: notWired }),
    ...(questions
      ? questionUseCases({ ...base, ...questions, questionsFor: questionStore })
      : { getSuggestedQuestions: questionsNotWired, suggestInterviewQuestions: questionsNotWired }),
  };
}

/** Who applied to what, read in the worker's transaction (the intake module's `createApplicationReads`). */
type ApplicationsPort = {
  jobsForCandidate(tx: Tx, workspaceId: string, candidateId: string): Promise<string[]>;
  candidatesForJob(tx: Tx, workspaceId: string, jobId: string): Promise<string[]>;
};

/**
 * The `assessment` queue's worker jobs (AIV-P1-031): each scores the candidates an event touches against the job's
 * approved rubric version and stores a result only when it changed, as the system in the envelope's workspace.
 * `EvidenceMapped.v1` scores that candidate for that job; `RubricApproved.v1` and `EvidenceRecorded.v1` reach this
 * queue only while evidence mapping is off (apps/backend/worker), and score every applicant of the job, or every job of the
 * candidate. The jobs, evidence and intake reads come from the worker's composition root.
 */
export function createAssessmentHandlers(config: {
  audit: Pick<AuditContract, 'record'>;
  approvedRubric: WorkerPorts['approvedRubric'];
  evidenceForJob: WorkerPorts['evidenceForJob'];
  applications: ApplicationsPort;
  now?: () => Date;
}): Handler<unknown>[] {
  const ports: WorkerPorts = {
    storeFor: assessmentStore,
    auditScoreChange: auditWith(config.audit),
    approvedRubric: config.approvedRubric,
    evidenceForJob: config.evidenceForJob,
    newId: () => uuidv7(),
    now: config.now ?? (() => new Date()),
  };
  return [
    {
      event: EvidenceMappedV1,
      inbox,
      consumer: 'assessment.evidence-mapped',
      handle: (tx, { candidateId, jobId, rubricVersionId }, envelope) =>
        assessForJob(ports, tx, envelope.workspaceId, jobId, [candidateId], rubricVersionId),
    } satisfies Handler<{ candidateId: string; jobId: string; rubricVersionId: string; mappingId: string }>,
    {
      event: ContradictionResolvedV1,
      inbox,
      consumer: 'assessment.contradiction-resolved',
      handle: (tx, { candidateId, jobId, rubricVersionId }, envelope) =>
        assessForJob(ports, tx, envelope.workspaceId, jobId, [candidateId], rubricVersionId),
    } satisfies Handler<{ candidateId: string; jobId: string; rubricVersionId: string; comparisonId: string }>,
    {
      event: RubricApprovedV1,
      inbox,
      consumer: 'assessment.rubric-approved',
      handle: async (tx, { jobId }, envelope) =>
        assessForJob(
          ports,
          tx,
          envelope.workspaceId,
          jobId,
          await config.applications.candidatesForJob(tx, envelope.workspaceId, jobId),
        ),
    } satisfies Handler<{ jobId: string; rubricVersionId: string; supersededVersionId: string | null }>,
    {
      event: EvidenceRecordedV1,
      inbox,
      consumer: 'assessment.evidence-recorded',
      async handle(tx, { candidateId }, envelope) {
        for (const jobId of await config.applications.jobsForCandidate(tx, envelope.workspaceId, candidateId))
          await assessForJob(ports, tx, envelope.workspaceId, jobId, [candidateId]);
      },
    } satisfies Handler<{ candidateId: string; sourceId: string; itemIds: string[] }>,
  ];
}

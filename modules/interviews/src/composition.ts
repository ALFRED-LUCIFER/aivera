// Builds the interviews module for an app (ADR-002: only apps and test suites import this).
import {
  AiUnavailable,
  BudgetExceeded,
  detectUnusualContent,
  InvalidCitation,
  mapSummaryRequest,
  MissingIdentifiers,
  SchemaMismatch,
  SourceTooLong,
  UncitedOutput,
  type AiClient,
} from '@credalent/ai';
import type { Handler, Scheduler } from '@credalent/db/consumer';
import { enqueue, newEnvelope } from '@credalent/db/outbox';
import { uuidv7 } from '@credalent/db/uuidv7';
import type { ApprovedRubricReads, JobsContract } from '@credalent/jobs';
import { log } from '@credalent/observability';
import { grantsCover, JOB_SCOPED_ROLES, type WorkspacesContract } from '@credalent/workspaces';
import { interviewUseCases, type Ports } from './application/interviews.ts';
import {
  analyseSummary,
  summaryUseCases,
  type AnalysisPorts,
  type DecisionPorts,
  type SummaryPorts,
} from './application/summary.ts';
import { InterviewScheduledV1, MeetingSummarySubmittedV1, type InterviewsContract } from './contracts/index.ts';
import { interviewStore } from './infrastructure/repository.ts';
import { inbox, outbox } from './infrastructure/schema.ts';
import { summaryStore } from './infrastructure/summaryRepository.ts';

// shortcut: the summary analysis shares the `assessment` queue, which every environment already has and consumes, so
// the pilot needs no infrastructure change; give interviews its own queue (infra/modules/messaging.bicep) with the
// first consumer of InterviewCompleted.v1 (AIV-P2-006).
export const SUMMARY_QUEUE = 'assessment';

const unusualSpans: SummaryPorts['unusualSpans'] = (text) => detectUnusualContent(text);

const notWired = async (): Promise<never> => {
  throw new Error('Meeting summaries are not wired in this app');
};

/**
 * `approvedRubric` is the jobs composition's `createApprovedRubricReads().approvedRubric`; `findApplication` is the intake
 * composition's `findApplication`. Both are unauthorised reads this module calls only for the job it then authorises.
 * Taken as functions, not modules, so intake can call this contract (AIV-P1-114) without a package cycle.
 * `now` is the injected clock (AGENTS.md 3.9); tests pass a fixed one. `decisions` are the assessment's and the
 * evidence contract's commands a meeting summary ends in (AIV-P1-115), as functions for the same reason; without them
 * the summary commands throw.
 */
export function createInterviews(
  workspaces: Pick<WorkspacesContract, 'authorize' | 'getWorkspace' | 'listMembers' | 'listJobGrants'>,
  jobs: Pick<JobsContract, 'getJob'>,
  approvedRubric: ApprovedRubricReads['approvedRubric'],
  findApplication: Ports['findApplication'],
  now: () => Date = () => new Date(),
  decisions?: DecisionPorts,
): InterviewsContract {
  const ports: Ports = {
    storeFor: interviewStore,
    publishInterviewScheduled: (tx, interview) =>
      enqueue(tx, outbox, InterviewScheduledV1, {
        workspaceId: interview.workspaceId,
        payload: { interviewId: interview.id, applicationId: interview.applicationId },
        dedupeKey: `interview-scheduled:${interview.id}`,
        occurredAt: interview.createdAt,
      }),
    authorize: (ctx, action, resource) => workspaces.authorize(ctx, action, resource),
    jobResource: async (ctx, jobId) => {
      const job = await jobs.getJob(ctx, jobId);
      return job && { jobId: job.id, clientId: job.clientId };
    },
    findApplication,
    approvedRubric,
    async canInterview(ctx, userId, job) {
      const member = (await workspaces.listMembers(ctx)).find((m) => m.userId === userId);
      if (member?.status !== 'active') return false;
      if (!JOB_SCOPED_ROLES.includes(member.role)) return true;
      // Read only by admins and recruiters (job_access.view), the roles createInterview has already authorised.
      const grants = (await workspaces.listJobGrants(ctx)).filter((g) => g.userId === userId);
      return grantsCover(grants, job);
    },
    isSyntheticWorkspace: async (ctx) => (await workspaces.getWorkspace(ctx))?.synthetic === true,
    newId: () => uuidv7(),
    now,
  };
  return {
    ...interviewUseCases(ports),
    ...(decisions
      ? summaryUseCases({
          ...ports,
          ...decisions,
          summariesFor: summaryStore,
          rubric: approvedRubric,
          unusualSpans,
          publishSubmitted: (tx, summary) =>
            enqueue(tx, outbox, MeetingSummarySubmittedV1, {
              workspaceId: summary.workspaceId,
              payload: { summaryId: summary.id, interviewId: summary.interviewId },
              dedupeKey: `meeting-summary:${summary.id}`,
              occurredAt: summary.createdAt,
            }),
        })
      : {
          submitMeetingSummary: notWired,
          getMeetingSummary: notWired,
          previewSummaryProposals: notWired,
          applySummaryProposals: notWired,
          declineSummaryProposals: notWired,
        }),
  };
}

// The answers a redelivery cannot change, and a model that stayed unavailable through the client's own retries: the
// summary is marked "could not be analysed" and the person rates on the scorecard, or pastes it again.
const REJECTED = [SchemaMismatch, InvalidCitation, UncitedOutput, AiUnavailable, MissingIdentifiers, SourceTooLong];

/**
 * The worker's job `interviews.summary.analyse` (AIV-P1-115), on `SUMMARY_QUEUE`: after `MeetingSummarySubmitted.v1`
 * it asks `interviews.mapSummary` through `ai` and stores one proposal per competency the interview tests, in the
 * envelope's workspace transaction, once per message id (`interviews.inbox`). It proposes only. `ai` undefined (no
 * model configured) marks the summary "could not be analysed". A spent daily AI budget marks it waiting and schedules
 * the same message for 00:05 UTC the next day (AIV-P1-089).
 */
export function createSummaryHandlers(config: {
  ai: Pick<AiClient, 'generateStructured'> | undefined;
  approvedRubric: ApprovedRubricReads['approvedRubric'];
  identifiersOf: AnalysisPorts['identifiersOf'];
  memberName: AnalysisPorts['memberName'];
  scheduler: Scheduler;
  now?: () => Date;
}): Handler<unknown>[] {
  const now = config.now ?? (() => new Date());
  const ports: AnalysisPorts = {
    storeFor: interviewStore,
    summariesFor: summaryStore,
    rubric: config.approvedRubric,
    unusualSpans,
    identifiersOf: config.identifiersOf,
    memberName: config.memberName,
    now,
    async mapSummary({ workspaceId, competencies, text, identifiers }) {
      if (!config.ai) return 'failed';
      const request = mapSummaryRequest(competencies, [{ id: 'summary', kind: 'interview', text }]);
      try {
        const answer = await config.ai.generateStructured({ ...request, workspaceId, identifiers });
        return { promptVersion: request.promptVersion, answer };
      } catch (error) {
        if (error instanceof BudgetExceeded) return 'budget_exceeded';
        if (!REJECTED.some((kind) => error instanceof kind)) throw error;
        // The error's name only: never the summary, the prompt or the answer (AGENTS.md 1.2).
        log.warn({ 'workspace.id': workspaceId, 'error.type': (error as Error).name }, 'meeting summary not analysed');
        return 'failed';
      }
    },
    retryAt: async (workspaceId, payload, at) => {
      await config.scheduler.schedule(
        SUMMARY_QUEUE,
        newEnvelope(MeetingSummarySubmittedV1, { workspaceId, payload, occurredAt: now() }),
        at,
      );
      log.info({ 'workspace.id': workspaceId }, 'meeting summary analysis rescheduled after the daily token budget');
    },
  };
  return [
    {
      event: MeetingSummarySubmittedV1,
      inbox,
      consumer: 'interviews.summary.analyse',
      handle: (tx, { summaryId }, envelope) => analyseSummary(ports, tx, envelope.workspaceId, summaryId),
    } satisfies Handler<{ summaryId: string; interviewId: string }>,
  ];
}

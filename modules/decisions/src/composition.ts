// Builds the decisions module for an app (ADR-002: only apps and test suites import this).
import type { AssessmentContract } from '@credalent/assessment';
import type { AuditContract } from '@credalent/audit';
import { enqueue } from '@credalent/db/outbox';
import { uuidv7 } from '@credalent/db/uuidv7';
import type { JobsContract } from '@credalent/jobs';
import type { WorkspacesContract } from '@credalent/workspaces';
import { packUseCases } from './application/packs.ts';
import { DecisionsRecordedV1, PackReadyV1, type DecisionsContract } from './contracts/index.ts';
import { packStore } from './infrastructure/repository.ts';
import { outbox } from './infrastructure/schema.ts';

/** `now` is the injected clock (AGENTS.md 3.9); tests pass a fixed one. */
export function createDecisions(
  workspaces: Pick<WorkspacesContract, 'authorize'>,
  jobs: Pick<JobsContract, 'getJob'>,
  assessment: Pick<AssessmentContract, 'listRanking' | 'getLatestAssessment'>,
  audit: Pick<AuditContract, 'record'>,
  now: () => Date = () => new Date(),
): DecisionsContract {
  return packUseCases({
    storeFor: packStore,
    publishPackReady: (tx, pack) =>
      enqueue(tx, outbox, PackReadyV1, {
        workspaceId: pack.workspaceId,
        payload: { packId: pack.id, jobId: pack.jobId },
        dedupeKey: `pack-ready:${pack.id}`,
        occurredAt: pack.preparedAt,
      }),
    publishDecisionsRecorded: (tx, pack, at) =>
      enqueue(tx, outbox, DecisionsRecordedV1, {
        workspaceId: pack.workspaceId,
        payload: { packId: pack.id, jobId: pack.jobId },
        dedupeKey: `decisions-recorded:${pack.id}`,
        occurredAt: at,
      }),
    authorize: (ctx, action, resource) => workspaces.authorize(ctx, action, resource),
    job: async (ctx, jobId) => {
      const job = await jobs.getJob(ctx, jobId);
      return job && { jobId: job.id, clientId: job.clientId, hiringOwnerUserId: job.hiringOwnerUserId };
    },
    ranking: async (ctx, jobId) => {
      const ranking = await assessment.listRanking(ctx, jobId);
      return ranking.status === 'ranked'
        ? { rubricVersionId: ranking.rubricVersionId, candidateIds: ranking.rows.map((r) => r.candidateId) }
        : null;
    },
    latestAssessment: (ctx, candidateId, jobId) => assessment.getLatestAssessment(ctx, candidateId, jobId),
    auditDecision: (ctx, jobId, d) =>
      audit.record(
        { tx: ctx.tx, workspaceId: ctx.workspaceId, actor: { type: 'user', id: d.decidedBy } },
        {
          action: 'decision.recorded',
          subject: { type: 'candidate', id: d.candidateId },
          note: d.note,
          after: { packId: d.packId, jobId, decision: d.decision },
        },
      ),
    auditPackCreated: (ctx, pack) =>
      audit.record(
        { tx: ctx.tx, workspaceId: ctx.workspaceId, actor: { type: 'user', id: ctx.userId } },
        {
          action: 'pack.created',
          subject: { type: 'pack', id: pack.id },
          after: { jobId: pack.jobId, rubricVersionId: pack.rubricVersionId },
        },
      ),
    auditMemberAdded: (ctx, jobId, m) =>
      audit.record(
        { tx: ctx.tx, workspaceId: ctx.workspaceId, actor: { type: 'user', id: ctx.userId } },
        {
          action: 'pack.member_added',
          subject: { type: 'candidate', id: m.candidateId },
          after: { packId: m.packId, jobId, assessmentId: m.assessmentId, position: m.position },
        },
      ),
    newId: () => uuidv7(),
    now,
  });
}

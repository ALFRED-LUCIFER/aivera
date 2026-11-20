import type { Tx } from '@credalent/db';
import type { Action, WorkspaceContext } from '@credalent/workspaces';
import type { NewEntry } from '@credalent/audit';
import { EvidenceError } from '../domain/evidence.ts';
import {
  canMove,
  DEFAULT_FOLLOW_UP,
  openClaims,
  PORTAL_TOKEN_DAYS,
  type OpenClaim,
  type RequestStatus,
} from '../domain/request.ts';
import type { EvidenceStore } from './evidence.ts';

export type EvidenceRequest = {
  id: string;
  workspaceId: string;
  candidateId: string;
  jobId: string;
  requestedBy: string;
  message: string | null;
  status: RequestStatus;
  followUpAfterDays: number;
  followUpMaxCount: number;
  sentAt: Date | null;
  createdAt: Date;
};

export type EvidenceRequestView = EvidenceRequest & { items: OpenClaim[] };

/** The outcomes the system records after a person sent the request; "sent" is never one of them. */
export type RequestOutcome = 'opened' | 'answered' | 'quiet';

/** The store over one workspace-scoped transaction. Every method filters by `workspaceId`. */
export type RequestStore = {
  insert(request: EvidenceRequest, items: OpenClaim[]): Promise<void>;
  get(workspaceId: string, requestId: string): Promise<EvidenceRequestView | null>;
  hasOpen(workspaceId: string, candidateId: string, jobId: string): Promise<boolean>;
  setStatus(workspaceId: string, requestId: string, status: RequestStatus, sentAt?: Date): Promise<void>;
  insertToken(
    workspaceId: string,
    requestId: string,
    tokenHash: string,
    expiresAt: Date,
    createdAt: Date,
  ): Promise<void>;
};

export type RequestPorts = {
  storeFor(tx: Tx): EvidenceStore;
  requestStoreFor(tx: Tx): RequestStore;
  authorize(ctx: WorkspaceContext, action: Action): Promise<void>;
  /** Writes the entry in `ctx.tx`: the last statement before commit (AGENTS.md 3.6). */
  audit(ctx: WorkspaceContext, entry: NewEntry): Promise<void>;
  /** Writes the request's event to the outbox in `tx`, so it commits only with the change. */
  publishRequestEvent(tx: Tx, request: EvidenceRequest, status: 'sent' | RequestOutcome): Promise<void>;
  /** A new random portal token (at least 256 bits, URL-safe) and its SHA-256 hex. */
  newToken(): { token: string; hash: string };
  newId(): string;
  now(): Date;
};

const DAY_MS = 86_400_000;

// shortcut: requests are open to admins and recruiters (`candidate.create`), as evidence recording is; hiring owners
// and interviewers reach them through an application's job once the inbox screens use them (AIV-P1-039).
export function requestUseCases(ports: RequestPorts) {
  const { storeFor, requestStoreFor, authorize, audit, publishRequestEvent, newToken, newId, now } = ports;

  const load = async (ctx: WorkspaceContext, requestId: string) => {
    const found = await requestStoreFor(ctx.tx).get(ctx.workspaceId, requestId);
    if (!found) throw new EvidenceError('request_not_found');
    return found;
  };

  return {
    /**
     * A draft naming only the candidate's open claims for the job, with the default follow-up policy. Throws
     * `EvidenceError('nothing_to_request')` "Nothing rests on a claim for this job" and creates nothing when there are
     * none, and `open_request` when the candidate already has an open request for the job.
     */
    async createDraftRequest(
      ctx: WorkspaceContext,
      input: { candidateId: string; jobId: string },
    ): Promise<EvidenceRequestView> {
      await authorize(ctx, 'candidate.create');
      const items = openClaims(
        input.jobId,
        await storeFor(ctx.tx).list(ctx.workspaceId, { candidateId: input.candidateId }, input.jobId),
      );
      if (items.length === 0) throw new EvidenceError('nothing_to_request');
      const requests = requestStoreFor(ctx.tx);
      if (await requests.hasOpen(ctx.workspaceId, input.candidateId, input.jobId))
        throw new EvidenceError('open_request');
      const request: EvidenceRequest = {
        id: newId(),
        workspaceId: ctx.workspaceId,
        candidateId: input.candidateId,
        jobId: input.jobId,
        requestedBy: ctx.userId,
        message: null,
        status: 'draft',
        followUpAfterDays: DEFAULT_FOLLOW_UP.afterDays,
        followUpMaxCount: DEFAULT_FOLLOW_UP.maxCount,
        sentAt: null,
        createdAt: now(),
      };
      await requests.insert(request, items);
      await audit(ctx, {
        action: 'evidence_request.created',
        subject: { type: 'evidence_request', id: request.id },
        after: { candidateId: request.candidateId, jobId: request.jobId, items: items.length },
      });
      return { ...request, items };
    },

    /**
     * A person sends the draft: it becomes "sent", a portal token is issued (stored hashed, valid 30 days) and
     * returned once, and `EvidenceRequestSent.v1` is written. Throws `EvidenceError('request_status')` for anything
     * but a draft.
     */
    async sendRequest(
      ctx: WorkspaceContext,
      requestId: string,
    ): Promise<{ request: EvidenceRequestView; portalToken: string }> {
      await authorize(ctx, 'candidate.create');
      const found = await load(ctx, requestId);
      if (!canMove(found.status, 'sent', 'user')) throw new EvidenceError('request_status');
      const sentAt = now();
      const { token, hash } = newToken();
      const requests = requestStoreFor(ctx.tx);
      await requests.setStatus(ctx.workspaceId, requestId, 'sent', sentAt);
      await requests.insertToken(
        ctx.workspaceId,
        requestId,
        hash,
        new Date(sentAt.getTime() + PORTAL_TOKEN_DAYS * DAY_MS),
        sentAt,
      );
      const request = { ...found, status: 'sent' as const, sentAt };
      await publishRequestEvent(ctx.tx, request, 'sent');
      await audit(ctx, {
        action: 'evidence_request.sent',
        subject: { type: 'evidence_request', id: requestId },
        before: { status: found.status },
        after: { status: 'sent' },
      });
      return { request, portalToken: token };
    },

    /**
     * What happened after sending, recorded by the system (the worker, the portal): opened, answered or quiet. A move
     * the system may not make, "sent" above all, throws `EvidenceError('request_status')` and changes nothing.
     */
    async recordRequestOutcome(ctx: WorkspaceContext, requestId: string, outcome: RequestOutcome): Promise<void> {
      await authorize(ctx, 'candidate.create');
      const found = await load(ctx, requestId);
      if (!canMove(found.status, outcome, 'system')) throw new EvidenceError('request_status');
      await requestStoreFor(ctx.tx).setStatus(ctx.workspaceId, requestId, outcome);
      await publishRequestEvent(ctx.tx, { ...found, status: outcome }, outcome);
    },

    /** A person closes the request. Audited. Throws `EvidenceError('request_status')` when it is already closed. */
    async closeRequest(ctx: WorkspaceContext, requestId: string): Promise<void> {
      await authorize(ctx, 'candidate.create');
      const found = await load(ctx, requestId);
      if (!canMove(found.status, 'closed', 'user')) throw new EvidenceError('request_status');
      await requestStoreFor(ctx.tx).setStatus(ctx.workspaceId, requestId, 'closed');
      await audit(ctx, {
        action: 'evidence_request.closed',
        subject: { type: 'evidence_request', id: requestId },
        before: { status: found.status },
        after: { status: 'closed' },
      });
    },

    /** The request with its items, or null when the workspace has none. Admins and recruiters. */
    async getRequest(ctx: WorkspaceContext, requestId: string): Promise<EvidenceRequestView | null> {
      await authorize(ctx, 'candidate.view');
      return requestStoreFor(ctx.tx).get(ctx.workspaceId, requestId);
    },
  };
}

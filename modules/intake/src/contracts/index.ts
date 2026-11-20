// The only public surface of @credalent/intake (ADR-002).
import type { EventDefinition } from '@credalent/db/outbox';
import type { WorkspaceContext } from '@credalent/workspaces';
import { z } from 'zod';
import type { ReceiveApplicationInput, ReceiveApplicationResult } from '../application/applications.ts';

export { IntakeError, PERSONAL_DATA_FIELDS, SOURCES, STAGES } from '../domain/application.ts';
export type { Source, Stage } from '../domain/application.ts';
export type { ReceiveApplicationInput, ReceiveApplicationResult } from '../application/applications.ts';

/**
 * Written to `intake.outbox` in the transaction that records an arrival or a member's link; evidence ingestion
 * consumes it on the `evidence` queue and reads every GitHub repository link (AIV-P1-076). Strict and
 * opaque ids only, so a link or a name in the payload is refused (AGENTS.md 1.2, 3.1).
 */
export const ApplicationReceivedV1 = {
  type: 'ApplicationReceived.v1',
  payload: z.strictObject({ applicationId: z.uuid(), sourceId: z.uuid() }),
} satisfies EventDefinition<{ applicationId: string; sourceId: string }>;

/** Every call takes the request context from `WorkspacesContract.withWorkspace` and runs in its scoped transaction. */
export interface IntakeContract {
  /**
   * Records one arrival: finds or creates the person, creates their application for the job or reuses it (a second
   * arrival adds a source), and writes `ApplicationReceived.v1`. Admins and recruiters. Throws
   * `IntakeError('job_not_found')`, writing nothing, when the job is not in the workspace.
   */
  receiveApplication(ctx: WorkspaceContext, input: ReceiveApplicationInput): Promise<ReceiveApplicationResult>;
  /**
   * A member adds a work link on an application: stored as a `recruiter` source and announced with
   * `ApplicationReceived.v1`, so evidence reads it when it is a GitHub repository and keeps it as a plain link
   * otherwise (AIV-P1-076). Admins and recruiters; hiring owners and interviewers on the application's job only, by
   * a grant on it or its client (`ForbiddenError`, writing nothing). Throws `IntakeError('application_not_found')`.
   */
  addLink(ctx: WorkspaceContext, applicationId: string, url: string): Promise<{ sourceId: string }>;
}

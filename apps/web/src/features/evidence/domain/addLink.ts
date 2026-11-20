import { z } from 'zod';

// A member adds a work link on a candidate's application (AIV-P1-076). Messages are keys under `evidence` in
// packages/i18n.

/** The server action's input, validated again on the server (AGENTS.md 3.7). The job is the application's, never sent. */
export const addLinkSchema = z.strictObject({
  applicationId: z.uuid(),
  url: z.url({ protocol: /^https?$/ }).max(2048),
});

/** `read`: a GitHub repository whose read is queued; otherwise the link is kept as a plain link and says so. */
export type AddLinkResult =
  | { ok: true; read: true }
  | { ok: true; read: false; message: 'repositoryStatus.plainLink' }
  | { ok: false; error: 'failed' };

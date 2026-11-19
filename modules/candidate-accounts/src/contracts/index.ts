// The only public surface of @aivera/candidate-accounts (ADR-002). Recruiter-side modules never import it (ADR-009).
import type { CandidateAccountContext, LinkToWorkspaceInput, RecordConsentInput } from '../application/accounts.ts';
import type { Account, Consent, WorkspaceLink } from '../domain/account.ts';

export { CandidateAccountError, CONSENT_PURPOSES, LINK_REASONS, PERSONAL_DATA_FIELDS } from '../domain/account.ts';
export type {
  Account,
  CandidateAccountErrorCode,
  Consent,
  ConsentPurpose,
  LinkReason,
  WorkspaceLink,
} from '../domain/account.ts';
export type { CandidateAccountContext, LinkToWorkspaceInput, RecordConsentInput } from '../application/accounts.ts';

/**
 * Every call takes the context from `withAccount`, so the account id never comes from client input. Nothing here is
 * sent to a workspace: a workspace receives only what the candidate submits, never the account id or the profile.
 */
export interface CandidateAccountsContract {
  /**
   * Runs `work` in a transaction scoped to the identity user's candidate account, creating the account (no workspace
   * id) on first use. `identityUserId` comes from the server-side candidate session only.
   */
  withAccount<T>(identityUserId: string, work: (ctx: CandidateAccountContext) => Promise<T>): Promise<T>;
  getMyAccount(ctx: CandidateAccountContext): Promise<Account>;
  /**
   * Records what the candidate agreed to, with the consent text's version. Throws `CandidateAccountError`
   * (`text_version`, `consent_target`: apply and answer name a workspace and job, a CV check neither).
   */
  recordConsent(ctx: CandidateAccountContext, input: RecordConsentInput): Promise<Consent>;
  /**
   * Stamps the withdrawal time; the row is kept. Throws `CandidateAccountError` (`consent_not_found`,
   * `already_withdrawn`).
   */
  withdrawConsent(ctx: CandidateAccountContext, consentId: string): Promise<Consent>;
  /**
   * Links the account to the workspace's candidate record. Throws `CandidateAccountError('consent_required')`, linking
   * nothing, unless the consent is this account's, open, for that workspace, and for the reason's purpose
   * (`applied` → `apply_to_job`). Linking the same workspace candidate again returns the existing link.
   * `workspaceId` and `workspaceCandidateId` must be the server-side result of the apply or answer flow in the same
   * request, never client input: the consent check binds the workspace and the purpose, not the job or the candidate
   * record, so AIV-P3-008 must not rely on it to tie a link to one job. The caller audits the
   * share in that workspace's transaction (AGENTS.md 3.6; AIV-P3-008, AIV-P3-013).
   */
  linkToWorkspace(ctx: CandidateAccountContext, input: LinkToWorkspaceInput): Promise<WorkspaceLink>;
  /** Every workspace link, oldest first (erasure, AIV-P3-014). */
  listMyWorkspaceLinks(ctx: CandidateAccountContext): Promise<WorkspaceLink[]>;
}

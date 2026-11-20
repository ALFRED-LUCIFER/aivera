import type { Tx } from '@credalent/db';
import {
  CandidateAccountError,
  checkLinkConsent,
  checkNewConsent,
  signUpName,
  withdrawalAt,
  type Account,
  type Consent,
  type ConsentPurpose,
  type LinkReason,
  type SignUpInput,
  type WorkspaceLink,
} from '../domain/account.ts';

/** One candidate's request: the account-scoped transaction and its account id, never from client input. */
export type CandidateAccountContext = { accountId: string; tx: Tx };

/** The store over one account-scoped transaction. Every method filters by `accountId`. */
export type AccountStore = {
  /** Creates the account (and its empty profile) unless it exists. */
  ensureAccount(accountId: string, now: Date): Promise<void>;
  getAccount(accountId: string): Promise<Account | null>;
  /** Sets full name and work type unless the account is signed up, in one statement; false when it was. */
  setSignUp(accountId: string, input: SignUpInput, now: Date): Promise<boolean>;
  insertConsent(consent: Consent): Promise<void>;
  /** The consent, locked for update so a link and a withdrawal of it never interleave; null when not this account's. */
  getConsentForUpdate(accountId: string, consentId: string): Promise<Consent | null>;
  setWithdrawn(accountId: string, consentId: string, at: Date): Promise<void>;
  /** Inserts the link; the existing one when the account is already linked to that workspace candidate. */
  insertLink(link: WorkspaceLink): Promise<WorkspaceLink>;
  listLinks(accountId: string): Promise<WorkspaceLink[]>;
};

export type Ports = {
  storeFor(tx: Tx): AccountStore;
  /** Runs `work` in a transaction scoped to the account (`withCandidateAccount`). */
  inAccount<T>(accountId: string, work: (tx: Tx) => Promise<T>): Promise<T>;
  newId(): string;
  now(): Date;
};

/** What the candidate agreed to. Its caller (a server action) validates the shape with zod (AGENTS.md 3.7). */
export type RecordConsentInput = {
  purpose: ConsentPurpose;
  workspaceId: string | null;
  jobId: string | null;
  textVersion: string;
};

export type LinkToWorkspaceInput = {
  consentId: string;
  workspaceId: string;
  workspaceCandidateId: string;
  reason: LinkReason;
};

export function accountsUseCases({ storeFor, inAccount, newId, now }: Ports) {
  async function getMyAccount(ctx: CandidateAccountContext): Promise<Account> {
    const account = await storeFor(ctx.tx).getAccount(ctx.accountId);
    if (!account) throw new Error('candidate account missing inside withAccount');
    return account;
  }

  return {
    /** `identityUserId` comes from the server-side candidate session only; it is also the account id. */
    withAccount<T>(identityUserId: string, work: (ctx: CandidateAccountContext) => Promise<T>): Promise<T> {
      return inAccount(identityUserId, async (tx) => {
        await storeFor(tx).ensureAccount(identityUserId, now());
        return work({ accountId: identityUserId, tx });
      });
    },

    getMyAccount,

    async signUp(ctx: CandidateAccountContext, input: SignUpInput): Promise<Account> {
      const fullName = signUpName(input.fullName);
      if (!(await storeFor(ctx.tx).setSignUp(ctx.accountId, { ...input, fullName }, now())))
        throw new CandidateAccountError('already_signed_up');
      return getMyAccount(ctx);
    },

    // shortcut: the caller checks the job is published in that workspace (public jobs read model); this module cannot
    // read jobs. AIV-P3-008 (apply) does it before calling.
    async recordConsent(ctx: CandidateAccountContext, input: RecordConsentInput): Promise<Consent> {
      checkNewConsent(input);
      const consent: Consent = {
        id: newId(),
        accountId: ctx.accountId,
        ...input,
        textVersion: input.textVersion.trim(),
        grantedAt: now(),
        withdrawnAt: null,
      };
      await storeFor(ctx.tx).insertConsent(consent);
      return consent;
    },

    async withdrawConsent(ctx: CandidateAccountContext, consentId: string): Promise<Consent> {
      const store = storeFor(ctx.tx);
      const consent = await store.getConsentForUpdate(ctx.accountId, consentId);
      if (!consent) throw new CandidateAccountError('consent_not_found');
      const withdrawnAt = withdrawalAt(consent, now());
      await store.setWithdrawn(ctx.accountId, consentId, withdrawnAt);
      // shortcut: application.consent_withdrawn is not published; write it to the outbox here, in ctx.tx, once
      // AIV-P0-014 lands (opaque workspace, job and consent ids only).
      return { ...consent, withdrawnAt };
    },

    async linkToWorkspace(ctx: CandidateAccountContext, input: LinkToWorkspaceInput): Promise<WorkspaceLink> {
      const store = storeFor(ctx.tx);
      checkLinkConsent(
        await store.getConsentForUpdate(ctx.accountId, input.consentId),
        input.workspaceId,
        input.reason,
      );
      return store.insertLink({ id: newId(), accountId: ctx.accountId, ...input, createdAt: now() });
    },

    /** Every workspace this account reached, oldest first: what erasure (AIV-P3-014) propagates to. */
    listMyWorkspaceLinks(ctx: CandidateAccountContext): Promise<WorkspaceLink[]> {
      return storeFor(ctx.tx).listLinks(ctx.accountId);
    },
  };
}

import type { Tx } from '@aivera/db/client';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { AccountStore } from '../application/accounts.ts';
import { account, consent, profile, workspaceLink } from './schema.ts';

/**
 * The store over an account-scoped transaction. The `account_id` filter here is the first layer; row-level security
 * on the transaction's `app.candidate_account_id` is the second (ADR-009).
 */
export function accountStore(tx: Tx): AccountStore {
  return {
    async ensureAccount(accountId, now) {
      await tx
        .insert(account)
        .values({ identityUserId: accountId, createdAt: now, updatedAt: now })
        .onConflictDoNothing();
      await tx.insert(profile).values({ accountId }).onConflictDoNothing();
    },
    async getAccount(accountId) {
      const [row] = await tx
        .select({
          id: account.identityUserId,
          fullName: account.fullName,
          workType: account.workType,
          headline: profile.headline,
          location: profile.location,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
        })
        .from(account)
        .leftJoin(profile, eq(profile.accountId, account.identityUserId))
        .where(eq(account.identityUserId, accountId));
      return row ?? null;
    },
    async insertConsent(values) {
      await tx.insert(consent).values(values);
    },
    async getConsentForUpdate(accountId, consentId) {
      const [row] = await tx
        .select()
        .from(consent)
        .where(and(eq(consent.accountId, accountId), eq(consent.id, consentId)))
        .for('update');
      return row ?? null;
    },
    async setWithdrawn(accountId, consentId, at) {
      await tx
        .update(consent)
        .set({ withdrawnAt: at })
        .where(and(eq(consent.accountId, accountId), eq(consent.id, consentId), isNull(consent.withdrawnAt)));
    },
    async insertLink(link) {
      const [inserted] = await tx.insert(workspaceLink).values(link).onConflictDoNothing().returning();
      if (inserted) return inserted;
      const [existing] = await tx
        .select()
        .from(workspaceLink)
        .where(
          and(
            eq(workspaceLink.accountId, link.accountId),
            eq(workspaceLink.workspaceId, link.workspaceId),
            eq(workspaceLink.workspaceCandidateId, link.workspaceCandidateId),
          ),
        );
      if (!existing) throw new Error('workspace link conflict but no link found');
      return existing;
    },
    listLinks(accountId) {
      return tx
        .select()
        .from(workspaceLink)
        .where(eq(workspaceLink.accountId, accountId))
        .orderBy(asc(workspaceLink.createdAt), asc(workspaceLink.id));
    },
  };
}

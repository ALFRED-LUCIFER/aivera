import type { CandidateAccountsContract } from '@aivera/candidate-accounts';
import { createCandidateAccounts } from '@aivera/candidate-accounts/composition';
import { getIdentity } from './auth';
import { getDb } from './db';

// The candidate's own account (AIV-P3-006, ADR-009), for candidate pages only, always with the user from the candidate
// session (candidateAuth.ts). Recruiter code never reads it.

let accounts: CandidateAccountsContract | undefined;
export const getCandidateAccounts = (): CandidateAccountsContract => (accounts ??= createCandidateAccounts(getDb()));

/** The identity user's display name from the tenant, to prefill sign-up; null when there is none. */
export const identityDisplayName = async (userId: string): Promise<string | null> =>
  (await getIdentity().getUser(userId))?.displayName ?? null;

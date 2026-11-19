// Builds the candidate-accounts module for an app (ADR-002: only apps import this).
// Not the @aivera/db index: it also exports the migrator, whose module paths do not resolve inside a Next.js bundle.
import type { Db } from '@aivera/db/client';
import { uuidv7 } from '@aivera/db/uuidv7';
import { withCandidateAccount } from '@aivera/db/with-workspace';
import { accountsUseCases } from './application/accounts.ts';
import type { CandidateAccountsContract } from './contracts/index.ts';
import { accountStore } from './infrastructure/repository.ts';

/** `now` is the injected clock (AGENTS.md 3.9); tests pass a fixed one. */
export function createCandidateAccounts(db: Db, now: () => Date = () => new Date()): CandidateAccountsContract {
  return accountsUseCases({
    storeFor: accountStore,
    inAccount: (accountId, work) => withCandidateAccount(db, accountId, work),
    newId: () => uuidv7(),
    now,
  });
}

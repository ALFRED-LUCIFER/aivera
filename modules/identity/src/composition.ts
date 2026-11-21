// Builds the identity module for an app (ADR-002: only apps import this).
// Not the @credalent/db index: it also exports the migrator, whose module paths do not resolve inside a Next.js bundle.
import type { Db } from '@credalent/db';
import { uuidv7 } from '@credalent/db/uuidv7';
import { identityUseCases } from './application/identity.ts';
import type { IdentityContract } from './contracts/index.ts';
import { identityStore } from './infrastructure/repository.ts';

/** `trustedIssuer` is the app's own External ID tenant issuer (ADR-009 point 4). */
export function createIdentity(db: Db, { trustedIssuer }: { trustedIssuer: string }): IdentityContract {
  return identityUseCases({
    trustedIssuer,
    inTransaction: (work) => db.transaction((tx) => work(identityStore(tx))),
    storeFor: identityStore,
    newId: () => uuidv7(),
  });
}

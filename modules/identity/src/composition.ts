// Builds the identity module for an app (ADR-002: only apps import this).
// Not the @aivera/db index: it also exports the migrator, whose module paths do not resolve inside a Next.js bundle.
import type { Db } from '@aivera/db';
import { uuidv7 } from '@aivera/db/uuidv7';
import { identityUseCases } from './application/identity.ts';
import type { IdentityContract } from './contracts/index.ts';
import { identityStore } from './infrastructure/repository.ts';

export function createIdentity(db: Db): IdentityContract {
  return identityUseCases({
    inTransaction: (work) => db.transaction((tx) => work(identityStore(tx))),
    newId: () => uuidv7(),
  });
}

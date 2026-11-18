// Builds the candidates module for an app (ADR-002: only apps import this).
import { uuidv7 } from '@aivera/db/uuidv7';
import type { WorkspacesContract } from '@aivera/workspaces';
import { peopleUseCases } from './application/people.ts';
import type { CandidatesContract } from './contracts/index.ts';
import { candidateStore } from './infrastructure/repository.ts';

/**
 * Every call runs in the request's `withWorkspace` transaction (`ctx.tx`), so no pool is needed here.
 * `now` is the injected clock (AGENTS.md 3.9); tests pass a fixed one.
 */
export function createCandidates(
  workspaces: Pick<WorkspacesContract, 'authorize'>,
  now: () => Date = () => new Date(),
): CandidatesContract {
  return peopleUseCases({
    storeFor: candidateStore,
    authorize: (ctx, action) => workspaces.authorize(ctx, action),
    newId: () => uuidv7(),
    now,
  });
}

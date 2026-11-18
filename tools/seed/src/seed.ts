// pnpm db:seed (AIV-P0-031): the synthetic demo workspace, written through each module's contract, never raw SQL.
import { createAudit } from '@aivera/audit/composition';
import { createCandidates } from '@aivera/candidates/composition';
import type { Db } from '@aivera/db/client';
import { createIdentity } from '@aivera/identity/composition';
import { createWorkspaces } from '@aivera/workspaces/composition';
import { CANDIDATES, HIRING_OWNERS, RECRUITER, WORKSPACE, type CastUser } from './cast.ts';

/** The cast's sign-in method: no real issuer, so no one can sign in as a seeded user. */
export const SEED_ISSUER = 'https://seed.aivera.example';

/** The APP_ENV values that hold synthetic data only (apps/web/src/server/env.ts); anything else, unset too, is refused. */
const SYNTHETIC_ENVS = ['local', 'dev'];

export class SeedRefused extends Error {
  constructor() {
    super('Seeding is not allowed in production');
    this.name = 'SeedRefused';
  }
}

/**
 * Seeds the demo workspace, or tops it up: running it again adds and changes nothing. `reset` first purges the demo
 * workspace (the recruiter's active workspace), which each module refuses unless it is flagged synthetic.
 * Returns the demo workspace id.
 */
export async function seedDemo(db: Db, { appEnv, reset = false }: { appEnv: string | undefined; reset?: boolean }) {
  // shortcut: trusts APP_ENV, not the database; APP_ENV=local against a pilot DATABASE_URL would add (never purge) a
  // synthetic workspace there. Check the server's environment marker once databases carry one.
  if (!SYNTHETIC_ENVS.includes(appEnv ?? '')) throw new SeedRefused();
  const identity = createIdentity(db, { trustedIssuer: SEED_ISSUER });
  const workspaces = createWorkspaces(db, createAudit(db));
  const candidates = createCandidates(workspaces);
  const userId = async (u: CastUser) =>
    (
      await identity.upsertUserFromIdToken({
        issuer: SEED_ISSUER,
        subject: u.key,
        email: u.email,
        emailVerified: true,
        displayName: u.displayName,
      })
    ).id;

  const recruiter = await userId(RECRUITER);
  const session = { userId: recruiter };
  // shortcut: the demo is AP's active workspace, so two seeds started at once can create two; find it by the synthetic
  // flag under a lock if concurrent seeding ever matters.
  let workspaceId = await workspaces.activeWorkspace(recruiter);
  if (workspaceId && reset) {
    await workspaces.withWorkspace(session, workspaceId, async (ctx) => {
      await candidates.purgeSyntheticPeople(ctx);
      await workspaces.purgeSyntheticWorkspace(ctx);
    });
    workspaceId = null;
  }
  workspaceId ??= (await workspaces.createWorkspace({ ...WORKSPACE, creatorUserId: recruiter })).id;

  const owners = await Promise.all(HIRING_OWNERS.map(userId));
  await workspaces.withWorkspace(session, workspaceId, async (ctx) => {
    for (const c of CANDIDATES)
      await candidates.findOrCreatePerson(ctx, {
        displayName: c.displayName,
        identifiers: [
          { type: 'email', value: c.email },
          { type: 'phone', value: c.phone },
        ],
        location: c.location,
        synthetic: c.synthetic,
      });
    // Last, so the audit entries of added members are the last writes before commit (AGENTS.md 3.6).
    for (const owner of owners) await workspaces.addSyntheticMember(ctx, owner, 'hiring_owner');
  });
  return workspaceId;
}

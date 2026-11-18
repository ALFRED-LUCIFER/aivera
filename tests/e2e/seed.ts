import { createAudit } from '@aivera/audit/composition';
import { createDb } from '@aivera/db/client';
import { withWorkspace } from '@aivera/db/with-workspace';
import { createIdentity } from '@aivera/identity/composition';
import { createWorkspaces } from '@aivera/workspaces/composition';
import { sql } from 'drizzle-orm';

// Playwright global setup (AIV-P0-010): the synthetic cast (docs/00-product/personas.md) gets its workspaces before the
// browser signs in. Each run creates new workspaces, which become their creators' active workspaces, so a reused local
// database works too. Huda signs in as she would before Gulf Talent Partners invites her (AIV-P1-003): no workspace.

export default async function seed() {
  // The same database as the dev server in playwright.config.ts.
  const db = createDb(process.env['E2E_DATABASE_URL'] ?? 'postgres://aivera_app:local_dev_only@localhost:5432/aivera', {
    max: 1,
  });
  // Seed sign-ins say email_verified: true, so which issuer is trusted does not matter here.
  const identity = createIdentity(db, { trustedIssuer: 'e2e-seed' });
  const workspaces = createWorkspaces(db, createAudit(db));
  const person = async (email: string, displayName: string) =>
    (
      await identity.upsertUserFromIdToken({
        issuer: 'e2e-seed',
        subject: email,
        email,
        emailVerified: true,
        displayName,
      })
    ).id;
  const workspaceOf = async (name: string, creatorUserId: string) =>
    (
      await workspaces.createWorkspace({
        name,
        company: name,
        hiringFocus: 'AI and LLM engineering',
        synthetic: true,
        creatorUserId,
      })
    ).id;

  try {
    await workspaceOf('Demo Hiring Co', await person('alex@example.com', 'Alex Recruiter'));
    await workspaceOf('Nadia Freelance', await person('nadia@example.com', 'Nadia Freelance'));
    const gulf = await workspaceOf('Gulf Talent Partners', await person('omar.agency@example.com', 'Omar Agency'));

    // Lina was an interviewer at Gulf Talent Partners with it as her active workspace, then her membership was removed.
    const lina = await person('lina@example.com', 'Lina Panel');
    await withWorkspace(db, gulf, (tx) =>
      tx.execute(sql`insert into workspaces.member (workspace_id, user_id, role, status)
        values (${gulf}, ${lina}, 'interviewer', 'active')`),
    );
    await workspaces.switchWorkspace({ userId: lina }, gulf);
    await withWorkspace(db, gulf, (tx) =>
      tx.execute(sql`update workspaces.member set status = 'removed' where user_id = ${lina}`),
    );
  } finally {
    await db.$client.end();
  }
}

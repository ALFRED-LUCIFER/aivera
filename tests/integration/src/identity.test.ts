import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, type Db } from '@aivera/db';
import { IdentityError, type IdentityContract, type IdTokenIdentity } from '@aivera/identity';
import { createIdentity } from '@aivera/identity/composition';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// AIV-P0-009: upsertUserFromIdToken against real PostgreSQL, as the non-owner aivera_app role (ADR-004, ADR-009).

const rolesSql = readFileSync(createRequire(import.meta.url).resolve('@aivera/db/sql/roles.sql'), 'utf8');
const dbCli = join(import.meta.dirname, '..', '..', '..', 'packages', 'db', 'src', 'cli.ts');
// The app's own External ID tenant (trusted without email_verified) and some other issuer (ADR-009 point 4).
const ISSUER = 'https://tenant.ciamlogin.aivera.example/v2.0';
const OTHER_ISSUER = 'https://other-idp.aivera.example';

let container: StartedPostgreSqlContainer;
let admin: Db;
let app: Db;
let identity: IdentityContract;

const urlFor = (role: string) =>
  `postgres://${role}:local_dev_only@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

const token = (overrides: Partial<IdTokenIdentity>): IdTokenIdentity => ({
  issuer: ISSUER,
  subject: 'subject-1',
  email: 'alex@example.com',
  emailVerified: true,
  displayName: 'Alex Rivera',
  ...overrides,
});

const methodsOf = async (userId: string) =>
  (
    await admin.execute<{ subject: string }>(
      sql`select subject from identity.sign_in_method where user_id = ${userId} order by subject`,
    )
  ).map((r) => r.subject);

const usersWith = async (email: string) =>
  Number(
    (await admin.execute<{ n: string }>(sql`select count(*) as n from identity.user where email = ${email}`))[0]?.n,
  );

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg17').withDatabase('aivera').start();
  admin = createDb(container.getConnectionUri(), { max: 1 });
  await admin.$client.unsafe(rolesSql);
  execFileSync(process.execPath, [dbCli, 'migrate'], {
    env: { ...process.env, DATABASE_MIGRATOR_URL: urlFor('aivera_migrator') },
  });
  app = createDb(urlFor('aivera_app'), { max: 2 });
  identity = createIdentity(app, { trustedIssuer: ISSUER });
});

afterAll(async () => {
  await app?.$client.end();
  await admin?.$client.end();
  await container?.stop();
});

describe('upsertUserFromIdToken', () => {
  it('creates the user once, and a repeat sign-in with the same method finds the same user', async () => {
    const first = await identity.upsertUserFromIdToken(token({ subject: 'alex-password' }));
    const again = await identity.upsertUserFromIdToken(token({ subject: 'alex-password' }));
    expect(again.id).toBe(first.id);
    expect(first.email).toBe('alex@example.com');
    expect(await usersWith('alex@example.com')).toBe(1);
    expect(await methodsOf(first.id)).toEqual(['alex-password']);
    expect(await identity.getUser(first.id)).toMatchObject({ id: first.id, email: 'alex@example.com' });
  });

  it('Scenario: One account per verified email: a second method for the same verified email joins the user', async () => {
    const password = await identity.upsertUserFromIdToken(
      token({ subject: 'nadia-password', email: 'nadia@example.com', displayName: 'Nadia Haddad' }),
    );
    const google = await identity.upsertUserFromIdToken(
      token({ subject: 'nadia-google', email: 'Nadia@Example.com', displayName: 'Nadia Haddad' }),
    );
    expect(google.id).toBe(password.id);
    expect(await usersWith('nadia@example.com')).toBe(1);
    expect(await methodsOf(password.id)).toEqual(['nadia-google', 'nadia-password']);
  });

  // SAFETY: mutation check: removed the `!isEmailVerified(...)` refusal in identityUseCases -> this test, "does not create a user either" and "another issuer" failed
  it('Scenario: An unverified email never joins an existing account (explicit email_verified false, even from our tenant)', async () => {
    const nadia = await identity.upsertUserFromIdToken(
      token({ subject: 'nadia-password', email: 'nadia@example.com' }),
    );
    const unverified = identity.upsertUserFromIdToken(
      token({ subject: 'nadia-unverified', email: 'nadia@example.com', emailVerified: false }),
    );
    await expect(unverified).rejects.toThrow(IdentityError);
    await expect(unverified).rejects.toThrow('Verify your email to continue.');
    expect(await methodsOf(nadia.id)).not.toContain('nadia-unverified');
  });

  it('an unverified email does not create a user either, so no one can claim an address before its owner', async () => {
    await expect(
      identity.upsertUserFromIdToken(token({ subject: 'omar-x', email: 'omar@example.com', emailVerified: false })),
    ).rejects.toThrow(IdentityError);
    expect(await usersWith('omar@example.com')).toBe(0);
  });

  it('our own tenant without an email_verified claim counts as verified: the tenant verifies email at sign-up', async () => {
    const huda = await identity.upsertUserFromIdToken(
      token({ subject: 'huda-password', email: 'huda@example.com', emailVerified: undefined }),
    );
    expect(await usersWith('huda@example.com')).toBe(1);
    expect(await methodsOf(huda.id)).toEqual(['huda-password']);
  });

  // SAFETY: mutation check: isEmailVerified trusted a missing claim from any issuer (dropped the issuer comparison) -> this test failed
  it('another issuer without an email_verified claim is refused', async () => {
    await expect(
      identity.upsertUserFromIdToken(
        token({ issuer: OTHER_ISSUER, subject: 'faisal-x', email: 'faisal@example.com', emailVerified: undefined }),
      ),
    ).rejects.toThrow(IdentityError);
    expect(await usersWith('faisal@example.com')).toBe(0);
  });

  it('updates the display name from the latest sign-in', async () => {
    const before = await identity.upsertUserFromIdToken(token({ subject: 'lina', email: 'lina@example.com' }));
    const after = await identity.upsertUserFromIdToken(
      token({ subject: 'lina', email: 'lina@example.com', displayName: 'Lina Q.' }),
    );
    expect(after).toMatchObject({ id: before.id, displayName: 'Lina Q.' });
    expect((await identity.getUser(before.id))?.displayName).toBe('Lina Q.');
  });

  it('two concurrent first sign-ins for one email make one user', async () => {
    const [a, b] = await Promise.all([
      identity.upsertUserFromIdToken(token({ subject: 'sam-password', email: 'sam@example.com' })),
      identity.upsertUserFromIdToken(token({ subject: 'sam-google', email: 'sam@example.com' })),
    ]);
    expect(a.id).toBe(b.id);
    expect(await methodsOf(a.id)).toEqual(['sam-google', 'sam-password']);
  });

  it('the database refuses a mixed-case email and a duplicate method', async () => {
    await expect(
      app.execute(sql`insert into identity.user (id, email) values (gen_random_uuid(), 'Mixed@Example.com')`),
    ).rejects.toMatchObject({ constraint: 'user_email_lower_case' });
    const [alex] = await admin.execute<{ id: string }>(
      sql`select id from identity.user where email = 'alex@example.com'`,
    );
    await expect(
      app.execute(
        sql`insert into identity.sign_in_method (user_id, issuer, subject) values (${alex?.id}, ${ISSUER}, 'alex-password')`,
      ),
    ).rejects.toMatchObject({ constraint: 'sign_in_method_pkey' });
  });

  it('getUser returns null for an unknown id', async () => {
    expect(await identity.getUser('0190d4a2-0000-7000-8000-00000000ffff')).toBeNull();
  });
});

import type { Tx } from '@aivera/db';
import { and, eq } from 'drizzle-orm';
import type { IdentityStore } from '../application/identity.ts';
import { signInMethod, user } from './schema.ts';

const userColumns = { id: user.id, email: user.email, displayName: user.displayName, createdAt: user.createdAt };

export function identityStore(tx: Tx): IdentityStore {
  const findBy = async (where: ReturnType<typeof eq>) =>
    (await tx.select(userColumns).from(user).where(where))[0] ?? null;
  return {
    async findByMethod(issuer, subject) {
      const [row] = await tx
        .select(userColumns)
        .from(signInMethod)
        .innerJoin(user, eq(user.id, signInMethod.userId))
        .where(and(eq(signInMethod.issuer, issuer), eq(signInMethod.subject, subject)));
      return row ?? null;
    },
    findById: (id) => findBy(eq(user.id, id)),
    async findOrInsertByEmail(values) {
      await tx.insert(user).values(values).onConflictDoNothing({ target: user.email });
      const found = await findBy(eq(user.email, values.email));
      if (!found) throw new Error('identity.user insert returned no row');
      return found;
    },
    async attachMethod(userId, issuer, subject) {
      await tx.insert(signInMethod).values({ userId, issuer, subject }).onConflictDoNothing();
    },
    async setDisplayName(userId, displayName) {
      await tx.update(user).set({ displayName }).where(eq(user.id, userId));
    },
  };
}

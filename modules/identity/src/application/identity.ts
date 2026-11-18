import { IdentityError, isEmailVerified, normalizeEmail, type IdTokenIdentity, type User } from '../domain/user.ts';

/** The store a use case sees inside one transaction. `identity` tables are global, not workspace-owned. */
export type IdentityStore = {
  findByMethod(issuer: string, subject: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  /** Inserts the user unless one with this email exists (a concurrent first sign-in), then returns the stored user. */
  findOrInsertByEmail(user: Omit<User, 'createdAt'>): Promise<User>;
  /** Attaches the method; a method that is already attached is left as it is. */
  attachMethod(userId: string, issuer: string, subject: string): Promise<void>;
  setDisplayName(userId: string, displayName: string): Promise<void>;
};

export type Ports = {
  inTransaction<T>(work: (store: IdentityStore) => Promise<T>): Promise<T>;
  newId(): string;
  /** Aivera's own External ID tenant issuer, whose emails count as verified without the claim. */
  trustedIssuer: string;
};

export function identityUseCases({ inTransaction, newId, trustedIssuer }: Ports) {
  return {
    upsertUserFromIdToken(token: IdTokenIdentity): Promise<User> {
      return inTransaction(async (store) => {
        const known = await store.findByMethod(token.issuer, token.subject);
        // An unverified email never creates or joins a user, so no one can claim an address before its owner does.
        if (!known && !isEmailVerified(token, trustedIssuer)) throw new IdentityError('unverified_email');
        const user =
          known ??
          (await store.findOrInsertByEmail({
            id: newId(),
            email: normalizeEmail(token.email),
            displayName: token.displayName,
          }));
        if (!known) await store.attachMethod(user.id, token.issuer, token.subject);
        if (token.displayName && token.displayName !== user.displayName) {
          await store.setDisplayName(user.id, token.displayName);
          return { ...user, displayName: token.displayName };
        }
        return user;
      });
    },

    getUser(id: string): Promise<User | null> {
      return inTransaction((store) => store.findById(id));
    },
  };
}

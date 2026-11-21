// The only public surface of @credalent/identity (ADR-002).
import type { Tx } from '@credalent/db/client';
import type { IdTokenIdentity, User } from '../domain/user.ts';

export { IdentityError } from '../domain/user.ts';
export type { IdTokenIdentity, User } from '../domain/user.ts';

export interface IdentityContract {
  /**
   * Finds the user by sign-in method, or by verified email (attaching the method), or creates one; updates the display
   * name. Throws `IdentityError('unverified_email')` for an unknown method whose email is not verified: neither
   * `email_verified: true` nor the trusted tenant without the claim.
   */
  upsertUserFromIdToken(token: IdTokenIdentity): Promise<User>;
  /**
   * Pass the request context (`{ tx }`) when one is open, so the read shares its connection instead of taking a second
   * one from the pool while the first is held (AIV-P2-061).
   */
  getUser(id: string, within?: { tx: Tx }): Promise<User | null>;
}

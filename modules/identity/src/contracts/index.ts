// The only public surface of @aivera/identity (ADR-002).
import type { IdTokenIdentity, User } from '../domain/user.ts';

export { IdentityError } from '../domain/user.ts';
export type { IdentityErrorCode, IdTokenIdentity, User } from '../domain/user.ts';

export interface IdentityContract {
  /**
   * Finds the user by sign-in method, or by verified email (attaching the method), or creates one; updates the display
   * name. Throws `IdentityError('unverified_email')` for an unknown method whose email is not verified: neither
   * `email_verified: true` nor the trusted tenant without the claim.
   */
  upsertUserFromIdToken(token: IdTokenIdentity): Promise<User>;
  getUser(id: string): Promise<User | null>;
}

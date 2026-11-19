import { isSignedUp, type Account } from '@aivera/candidate-accounts';
import { JOB_TYPES } from '@aivera/jobs';
import { z } from 'zod';
import { CANDIDATE_HOME, candidateSafeNext } from '@/features/candidate-sign-in/domain/candidateSignIn.ts';

// Candidate sign-up (AIV-P3-007). Pure: no React, no I/O (ADR-003). Email, password and verification happen on the
// tenant's hosted page (AIV-P0-011), so the app asks only for what the tenant does not know.

export const CANDIDATE_SIGN_UP = '/candidates/signup';
/**
 * Where sign-up ends: the sanitised candidate page the person was going to (the apply form, say), never sign-up itself
 * (that would loop); My applications by default.
 */
export function signUpNext(value: unknown): string {
  const next = candidateSafeNext(value);
  return /^\/candidates\/signup(?:[/?#]|$)/.test(next) ? CANDIDATE_HOME : next;
}

/** Sign-up, remembering where to go after it; the plain address when that is My applications. */
export const signUpHref = (next: string) =>
  next === CANDIDATE_HOME ? CANDIDATE_SIGN_UP : (`${CANDIDATE_SIGN_UP}?next=${encodeURIComponent(next)}` as const);

/** Shows "Create account and start Plus" once Plus payment exists (AIV-P4-004); off until then. */
export const PLUS_SIGN_UP_FLAG = 'candidatePlusSignUp';

/**
 * What `/candidates/signup` shows, decided on the server from the candidate session: the sign-up panel when signed out,
 * the full name and work type form until the account has them, else My applications.
 */
export type SignUpStep = 'signedOut' | 'profile' | 'done';
export const signUpStep = (
  userId: string | null,
  account: Pick<Account, 'fullName' | 'workType'> | null,
): SignUpStep => (!userId ? 'signedOut' : account && isSignedUp(account) ? 'done' : 'profile');

// Messages are keys under candidate.signup.errors (i18n).
const signUpForm = z.object({
  fullName: z.string().trim().min(1, 'fullNameRequired').max(200, 'fullNameTooLong'),
  workType: z.enum(JOB_TYPES, 'workTypeRequired'),
});
type SignUpForm = z.infer<typeof signUpForm>;
type SignUpField = keyof SignUpForm;
type SignUpErrorKey = 'fullNameRequired' | 'fullNameTooLong' | 'workTypeRequired';

/** What the form shows after a refused or failed submit: each field's error, and what was typed so nothing is lost. */
export type SignUpState = {
  errors: Partial<Record<SignUpField, SignUpErrorKey>>;
  failed: boolean;
  values: Record<SignUpField, string>;
};
export const initialSignUpState = (fullName: string): SignUpState => ({
  errors: {},
  failed: false,
  values: { fullName, workType: '' },
});

/**
 * The posted form, validated (AGENTS.md 3.7). Reads only the two fields: anything else posted, such as a user id, is
 * ignored; the user always comes from the session.
 */
export function parseSignUpForm(form: FormData): { input: SignUpForm } | SignUpState {
  const values = { fullName: String(form.get('fullName') ?? ''), workType: String(form.get('workType') ?? '') };
  const result = signUpForm.safeParse(values);
  if (result.success) return { input: result.data };
  const errors: SignUpState['errors'] = {};
  for (const issue of result.error.issues) errors[issue.path[0] as SignUpField] ??= issue.message as SignUpErrorKey;
  return { errors, failed: false, values };
}

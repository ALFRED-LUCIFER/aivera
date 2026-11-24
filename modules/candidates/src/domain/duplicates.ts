// When two person records are the same candidate (AIV-P1-018). Pure: the merge use cases decide what to do with it.
import { UNNAMED_APPLICANT, type IdentifierType, type Person } from './person.ts';

/**
 * A name reduced for comparison: accents and case dropped, and every space, hyphen and dot removed, so
 * "Omar Al Suwaidi", "Omar Alsuwaidi" and "omar al-suwaidi" compare equal. Arabic and other scripts keep their letters.
 * Empty for a person not named yet, who never matches by name.
 */
export const nameKey = (name: string) =>
  name === UNNAMED_APPLICANT
    ? ''
    : name
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLocaleLowerCase('en')
        .replace(/[^\p{L}\p{N}]/gu, '');

const sameName = (a: string, b: string) => {
  const key = nameKey(a);
  return key !== '' && key === nameKey(b);
};

/** Why an arrival proves two records are one person: merged automatically, no one asked. */
export type ExactReason = 'same_cv_file' | 'same_email' | 'same_phone' | 'same_name_and_github';

/** The audit note of an automatic merge (the ticket's "merged automatically: same CV file"). */
export const AUTO_MERGE_NOTES: Record<ExactReason, string> = {
  same_cv_file: 'merged automatically: same CV file',
  same_email: 'merged automatically: same email',
  same_phone: 'merged automatically: same phone',
  same_name_and_github: 'merged automatically: same name and GitHub login',
};

/**
 * An arrival that holds another person's identifiers of `types` is that person too, so the two records are exact
 * duplicates: a shared email, phone or CV file, or a shared GitHub login when the names match as well. Null when the
 * match is not enough on its own (a GitHub login with another name).
 */
export function exactReason(
  types: readonly IdentifierType[],
  arrivalName: string,
  otherName: string,
): ExactReason | null {
  if (types.includes('cv_hash')) return 'same_cv_file';
  if (types.includes('email')) return 'same_email';
  if (types.includes('phone')) return 'same_phone';
  if (types.includes('github_login') && sameName(arrivalName, otherName)) return 'same_name_and_github';
  return null;
}

const shares = (x: string[], y: string[]) => x.some((v) => y.includes(v));

/** Why two records may be one person: a recruiter decides. */
export type LikelyReason = 'same_name' | 'same_contact';

/**
 * Likely the same person: the same name, or an email or phone on both records. Two people never share an identifier
 * (they would be one person already), so a shared address means at least one came from a CV, which is unverified
 * (AIV-P1-025): a person confirms it, nothing merges on it.
 */
export function likelyReason(
  a: Pick<Person, 'displayName' | 'emails' | 'phones'>,
  b: Pick<Person, 'displayName' | 'emails' | 'phones'>,
): LikelyReason | null {
  if (sameName(a.displayName, b.displayName)) return 'same_name';
  if (shares(a.emails, b.emails) || shares(a.phones, b.phones)) return 'same_contact';
  return null;
}

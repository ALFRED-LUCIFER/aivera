// A region the product stores never rests on a line about the people to hire (AIV-P2-082, AGENTS.md 1.5): a
// nationality, residency, age or gender preference is a protected trait, never where the job is based.

// shortcut: an English keyword list, not a classifier; extend it when a live eval or an Arabic job text shows a miss.
const PEOPLE_TO_HIRE =
  /\b(nationals?|nationality|citizens?|citizenship|residents?|residency|passports?|born in|native speakers?|locals|aged?|years old|gender|male|female|(candidates?|applicants?|people|those|someone|engineers?|hires?) from)\b/i;

/** True when every sentence of `quote` is about who to hire, so it says nothing about where the job is. */
export const aboutPeopleToHire = (quote: string): boolean =>
  quote
    .split(/(?<=[.!?;\n])\s*/)
    .filter((s) => s.trim())
    .every((s) => PEOPLE_TO_HIRE.test(s));

/**
 * Keeps a region only if at least one citation quotes something other than a line about the people to hire. The rest
 * are discarded, not rewritten, as `guardLinks` (evidence mapping) discards a bad link and keeps the good ones: the
 * answer passed its schema, so the domain and the other regions stand.
 */
export const regionsNotAboutPeople = <R extends { citations: readonly { quote: string }[] }>(
  regions: readonly R[],
): R[] => regions.filter((r) => r.citations.some((c) => !aboutPeopleToHire(c.quote)));

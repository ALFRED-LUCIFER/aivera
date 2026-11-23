// A region the product stores never rests on a line about the people to hire (AIV-P2-082, AGENTS.md 1.5): a
// nationality, residency, age or gender preference is a protected trait, never where the job is based.

// shortcut: an English keyword list, not a classifier; it also drops business lines such as "for Dubai residents" (the
// safe side: a lost suggestion). Extend it when a live eval or an Arabic job text shows a miss.
const PEOPLE_TO_HIRE =
  /\b(nationals?|nationality|citizens?|citizenship|residents?|residency|passports?|born in|(native |arabic |english )?speakers?|locals|emiratis|emiratisation|emiratization|saudis[ai]tion|aged?|years old|gender|male|female|(candidates?|applicants?|people|those|someone|engineers?|hires?) from|(emirati|saudi|indian|arab|gcc|western|asian|european|african) (candidates?|applicants?|talent))\b/i;

/** True when any part of `quote` is about who to hire: such a quote never backs a region, even beside a place. */
export const aboutPeopleToHire = (quote: string): boolean => PEOPLE_TO_HIRE.test(quote);

/**
 * Drops each citation that quotes a line about the people to hire, then each region left with none. Items are
 * discarded, never rewritten, as `guardLinks` (evidence mapping) discards a bad link and keeps the good ones: the
 * answer passed its schema, so the domain and the other regions stand (AGENTS.md 3.7 still rejects a failed schema).
 */
export const regionsNotAboutPeople = <C extends { quote: string }>(
  regions: readonly { region: string; citations: readonly C[] }[],
): { region: string; citations: C[] }[] =>
  regions
    .map((r) => ({ region: r.region, citations: r.citations.filter((c) => !aboutPeopleToHire(c.quote)) }))
    .filter((r) => r.citations.length > 0);

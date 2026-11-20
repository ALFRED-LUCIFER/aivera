import type { Source } from './citations.ts';

// Fairness inputs (ADR-006 point 7, AIV-P1-080): the candidate's name and every email and phone are replaced with
// placeholders in each source before a prompt is built, once, here, for every task. Pure: the placeholder-to-value
// pairs live only inside one call and are never stored, logged or returned.

/** The candidate's known identifiers, from the candidate record. */
export type Identifiers = { names: readonly string[]; emails: readonly string[]; phones: readonly string[] };

export const CANDIDATE_PLACEHOLDER = '[CANDIDATE]';

/**
 * The only tasks that may send emails and phones as written: extracting the candidate's own contact details onto the
 * record is their job. The name is still replaced. Every other task, including any later CV task, has them replaced.
 */
export const CONTACT_EXTRACTION_TASKS: readonly string[] = ['evidence.parseCv'];

/** A task sent candidate sources without the candidate's identifiers; no request was made. */
export class MissingIdentifiers extends Error {
  override name = 'MissingIdentifiers';
  constructor(task: string) {
    super(`AI task ${task} sends candidate sources without the candidate's identifiers`);
  }
}

/** One replacement: at `at` in the redacted text, `length` long, standing for `fromLength` characters at `from`. */
type Cut = { at: number; length: number; from: number; fromLength: number };

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const letter = String.raw`[\p{L}\p{M}\p{N}_]`;
const EMAIL = String.raw`[\w.%+-]+@[\w-]+(?:\.[\w-]+)+`;
// Never after a letter, a digit, a dot or a comma, so a decimal (0.82) or a dotted date (06.2020) never starts one.
const DIAL = String.raw`(?<![\w+(.,])\(?(?:\+|00)?\(?`;
const END = String.raw`(?![\w]|[.,]\d)`;
// Up to two of space, dash or bracket between digits; no dot, so decimals and dotted dates stay numbers.
const PHONE = String.raw`${DIAL}\d(?:[ ()-]{0,2}\d){7,14}${END}`;
// A phone starts with +, 00, 0 or a bracket, or has a run of four digits: "120 340 560 ms" is a metric list.
const phoneShaped = (value: string) => /^\(?(?:\+|0)/.test(value) || /\d{4}/.test(value);
const yearsOrDate = /^(?:(?:19|20)\d\d[ -]*)+$|^\d{4}-\d\d-\d\d$/;
// shortcut: a bare run of 8 to 15 digits with a four-digit group (an id, a count) is replaced too, while a login handle
// (sara_alqahtani) and Arabic-Indic digits are not matched; widen from pilot sources if either reaches a prompt.
// Particles that are a name part only next to another part: "Al Qahtani" is the candidate, "Al Ain" is a place.
const PARTICLES = new Set(['al', 'el', 'bin', 'bint', 'ibn', 'abu', 'de', 'da', 'di', 'van', 'von', 'le', 'la']);

function patternFor({ names, emails, phones }: Identifiers): RegExp {
  const parts = [...new Set(names.flatMap((name) => name.trim().split(/[\s-]+/)))]
    .filter((part) => (part.match(/\p{L}/gu)?.length ?? 0) >= 2)
    .toSorted((a, b) => b.length - a.length);
  const alone = parts.filter((part) => !PARTICLES.has(part.toLowerCase()));
  const word = (list: string[]) => `(?:${list.map(escape).join('|')})(?!${letter})`;
  const particles = alone.length ? parts.filter((part) => !alone.includes(part)) : [];
  const own = word(alone.length ? alone : parts);
  const lead = particles.length ? `(?:${word(particles)}[\\s-]+)*` : '';
  // A run of name parts ("Sara Al Qahtani", "Al-Qahtani's") is one placeholder; it starts and ends on a non-particle.
  const run = parts.length
    ? `(?<name>(?<!${letter})${lead}${own}(?:[\\s-]+${lead}${own})*(?:['’]s(?!${letter}))?)`
    : '';
  // The record's own phones match by their digits in any formatting, spaced dashes included, at any length.
  const record = phones
    .map((phone) => phone.replace(/\D/g, '').replace(/^00/, ''))
    .filter(Boolean)
    .map((digits) => `${DIAL}${[...digits].join(String.raw`[\s().\-–]{0,3}`)}${END}`);
  // Order matters: an email holding a name part is one email, the record's own phones before the generic shape. The
  // record's emails are listed for any the generic shape would miss.
  const alternatives = [
    `(?<email>${[...emails.filter(Boolean).map(escape), EMAIL].join('|')})`,
    ...(record.length ? [`(?<own>${record.join('|')})`] : []),
    `(?<phone>${PHONE})`,
    ...(run ? [run] : []),
  ];
  return new RegExp(alternatives.join('|'), 'giu');
}

/** Where an offset in the redacted text falls in the original; a span touching a placeholder covers its whole value. */
function toOriginal(cuts: readonly Cut[], offset: number, end: boolean): number {
  let shift = 0;
  for (const cut of cuts) {
    if (offset >= cut.at + cut.length) shift = cut.from + cut.fromLength - cut.at - cut.length;
    else if (end ? offset > cut.at : offset >= cut.at) return end ? cut.from + cut.fromLength : cut.from;
    else break;
  }
  return offset + shift;
}

export type Redaction = {
  /** The sources as the model sees them, in the same order. */
  sources: Source[];
  /** A span of the redacted `sources[index]` as a span of the original source text. */
  original(index: number, span: { start: number; end: number }): { start: number; end: number };
};

/**
 * Replaces the candidate's name parts (and possessives) with `[CANDIDATE]`, and every email and phone with
 * `[EMAIL_n]` and `[PHONE_n]`, numbered per call so the same value always gets the same placeholder. With
 * `keepContact`, emails and phones stay as written.
 */
export function redactSources(sources: readonly Source[], identifiers: Identifiers, keepContact: boolean): Redaction {
  const pattern = patternFor(identifiers);
  const numbers = { EMAIL: new Map<string, string>(), PHONE: new Map<string, string>() };
  const numbered = (kind: keyof typeof numbers, key: string) => {
    const seen = numbers[kind];
    const placeholder = seen.get(key) ?? `[${kind}_${seen.size + 1}]`;
    seen.set(key, placeholder);
    return placeholder;
  };
  const cutsOf: Cut[][] = [];
  const redacted = sources.map((source) => {
    const cuts: Cut[] = [];
    let text = '';
    let last = 0;
    for (const match of source.text.matchAll(pattern)) {
      const value = match[0];
      const { email, own, phone } = match.groups ?? {};
      let to = CANDIDATE_PLACEHOLDER;
      if (email || own || phone) {
        if (phone && (!phoneShaped(value) || yearsOrDate.test(value))) continue;
        if (keepContact) continue;
        to = email
          ? numbered('EMAIL', value.toLowerCase())
          : numbered('PHONE', value.replace(/\D/g, '').replace(/^00/, ''));
      }
      text += source.text.slice(last, match.index);
      cuts.push({ at: text.length, length: to.length, from: match.index, fromLength: value.length });
      text += to;
      last = match.index + value.length;
    }
    cutsOf.push(cuts);
    return { ...source, text: text + source.text.slice(last) };
  });
  return {
    sources: redacted,
    original: (index, { start, end }) => {
      const cuts = cutsOf[index] ?? [];
      return { start: toOriginal(cuts, start, false), end: toOriginal(cuts, end, true) };
    },
  };
}

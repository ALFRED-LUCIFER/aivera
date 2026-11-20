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
// Up to two of space, dash, dot or bracket between digits, with a leading + or 00.
const SEP = String.raw`[ ().-]{0,2}`;
const DIAL = String.raw`(?<![\w+(])\(?(?:\+|00)?\(?`;
// shortcut: 8 to 15 digits read as a phone, so a long bare number (an id, a count) is replaced too and a year range or
// ISO date is left alone; tighten from pilot sources if either shows up in a prompt where it should not.
const PHONE = String.raw`${DIAL}\d(?:${SEP}\d){7,14}(?![\w])`;
const notPhone = /^(?:(?:19|20)\d\d ?- ?(?:19|20)\d\d|\d{4}-\d\d-\d\d)$/;

function patternFor({ names, emails, phones }: Identifiers): RegExp {
  const parts = [...new Set(names.flatMap((name) => name.trim().split(/\s+/)))]
    .filter((part) => (part.match(/\p{L}/gu)?.length ?? 0) >= 2)
    .toSorted((a, b) => b.length - a.length)
    .map(escape);
  const name = `(?:${parts.join('|')})(?!${letter})`;
  // A run of name parts ("Sara Al Qahtani", "Al Qahtani's") is one placeholder.
  const run = parts.length
    ? `(?<name>(?<!${letter})${name}(?:\\s+${name})*(?:['’]s(?!${letter})|['’](?!${letter}))?)`
    : '';
  const own = phones
    .map((phone) => phone.replace(/\D/g, '').replace(/^00/, ''))
    .filter(Boolean)
    .map((digits) => `${DIAL}${[...digits].join(SEP)}(?![\\w])`);
  // Order matters: an email holding a name part is one email, the record's own phones before the generic shape.
  const alternatives = [
    `(?<email>${[...emails.filter(Boolean).map(escape), EMAIL].join('|')})`,
    ...(own.length ? [`(?<own>${own.join('|')})`] : []),
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
  /** Emails and phones left as written (contact extraction tasks only); no statement may repeat one. */
  kept: string[];
  /** A span of the redacted `sources[index]` as a span of the original source text. */
  original(index: number, span: { start: number; end: number }): { start: number; end: number };
};

/**
 * Replaces the candidate's name parts (and possessives) with `[CANDIDATE]`, and every email and phone with
 * `[EMAIL_n]` and `[PHONE_n]`, numbered per call so the same value always gets the same placeholder. With
 * `keepContact`, emails and phones stay as written and are listed in `kept`.
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
  const kept: string[] = [];
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
        if (phone && notPhone.test(value)) continue;
        if (keepContact) {
          kept.push(value);
          continue;
        }
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
    kept,
    original: (index, { start, end }) => {
      const cuts = cutsOf[index] ?? [];
      return { start: toOriginal(cuts, start, false), end: toOriginal(cuts, end, true) };
    },
  };
}

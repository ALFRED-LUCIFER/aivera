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
type Cut = { at: number; length: number; from: number; fromLength: number; trait: boolean };
/** Spacing and separators trimmed off a quote's ends once a placeholder is cut away. */
const EDGE = /[\s.,;:!?·•|،–-]/;

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// An alternation, not one class: V8 compiles the merged class about twice as slowly, once per use, per call.
const letter = String.raw`(?:\p{L}|\p{M}|\p{N}|_)`;
// An email's local part may hold any letter ("Zoë@acme.com"), so a name inside it is always part of the email.
const LOCAL = String.raw`[\p{L}\p{M}\p{N}_.%+-]`;
// Starts only at the start of a run, so a long run with no @ is scanned once, not from every position.
const EMAIL = String.raw`(?<!${LOCAL})${LOCAL}+@[\w-]+(?:\.[\w-]+)+`;
// Never after a letter, a digit, a dot or a comma, so a decimal (0.82) or a dotted date (06.2020) never starts one.
const DIAL = String.raw`(?<![\w+(.,])\(?(?:\+|00)?\(?`;
const END = String.raw`(?![\w]|[.,]\d)`;
// Up to two of space, dash or bracket between digits. Dots only in a dialled (+971.50.123.4567) or local
// (050.123.4567) shape, so decimals and dotted dates stay numbers.
const PHONE = String.raw`${DIAL}\d(?:[ ()-]{0,2}\d){7,14}${END}`;
const DOTTED = String.raw`(?<![\w+(.,])(?:(?:\+|00)\d{1,4}(?:\.\d{1,4}){2,5}|0\d{2,3}\.\d{3}\.\d{3,4})${END}`;
// A phone starts with +, 00, 0 or a bracket, or has a run of four digits: "120 340 560 ms" is a metric list.
const phoneShaped = (value: string) => /^\(?(?:\+|0)/.test(value) || /\d{4}/.test(value);
const yearsOrDate = /^(?:(?:19|20)\d\d[ -]*)+$|^\d{4}-\d\d-\d\d$/;
// shortcut: a bare run of 8 to 15 digits with a four-digit group (an id, a count) is replaced too, while a login handle
// (sara_alqahtani), Arabic-Indic digits and a dial code without + or 0 (971 50 123 456) are not matched; a phone that
// runs straight into an email ("050 123 4567-x@…") loses its tail to the email and its first digits stay (no number can
// be rebuilt from them); widen from pilot sources if one reaches a prompt.
// Particles that are a name part only next to another part: "Al Qahtani" is the candidate, "Al Ain" is a place.
const PARTICLES = new Set(['al', 'el', 'bin', 'bint', 'ibn', 'abu', 'de', 'da', 'di', 'van', 'von', 'le', 'la']);

// Protected traits (AIV-P2-065, AGENTS.md 1.5), in CV, document and reference sources only (a repository's
// `age: number;` stays): a labelled field, Latin or Arabic label, becomes `[REMOVED]` with its value. A label counts
// only at a field start (line start or after · • | ; , ، : or a bracket), so "Project name:" or "storage:" in a skills
// line stay, and is followed by a colon, a spaced dash or a tab. The value runs to the line end, the next · • | ; or a
// comma before another "Label:". A bare label's value may sit on the next line: one short field (40 characters at most,
// no colon), removed even when it is not the value; never after Photo, whose next line is usually the next section.
// `[REMOVED]` that the model repeats in its text is shown to a recruiter as written.
const PROTECTED_PLACEHOLDER = '[REMOVED]';
const TRAIT_KINDS: ReadonlySet<Source['kind']> = new Set(['cv', 'document', 'reference']);
const TRAIT_LABELS = [
  'nationality',
  'citizenship',
  'date of birth',
  'birth ?date',
  String.raw`d\.?o\.?b\.?`,
  'place of birth',
  'born',
  'age',
  'marital status',
  'civil status',
  'family status',
  'gender',
  'sex',
  'religion',
  'photo(?:graph)?',
  'الجنسية',
  'تاريخ الميلاد',
  'مكان الميلاد',
  'العمر',
  'السن',
  'الحالة الاجتماعية',
  'الجنس',
  'الديانة',
  'الدين',
  'الصورة',
];
const GAP = String.raw`[ \t\u200e\u200f]*`;
const FIELD = String.raw`(?:^|[\n·•|;,،:(\[])${GAP}`;
const SEPARATOR = String.raw`(?:[ \t]*[:：]|[ \t]+[-–][ \t]|\t)`;
const VALUE = String.raw`[^\n·•|;]*?(?=[ \t]*(?:$|[\n·•|;]|[,،][ \t]*\p{L}[\p{L}\p{M} .]{0,29}[:：]))`;
const NEXT_LINE = String.raw`(?<!(?:photo(?:graph)?|الصورة)${SEPARATOR})${GAP}\r?\n${GAP}[^\n·•|;:：]{1,40}?(?=[ \t]*(?:$|[\n·•|;]))`;
// shortcut: unlabelled traits are caught only as "34 years old", "34-year-old", "aged 34", "Photo attached" and
// "[photo ...]"; a "20-year-old codebase" is removed too. Widen from pilot CVs if another shape reaches a prompt.
const TRAIT = [
  String.raw`(?<=${FIELD})photo(?:graph)?(?:[ \t]*[:：])?\s*(?:attached|enclosed|included|(?:available )?on request)(?!${letter})`,
  String.raw`(?<=${FIELD})(?:${TRAIT_LABELS.join('|')})${SEPARATOR}(?:${NEXT_LINE}|${VALUE})`,
  String.raw`(?<!${letter})(?:aged[ \t]+\d{2}|\d{2}[ -](?:years?|yrs)[ -]old)(?!${letter})`,
  String.raw`[[(][ \t]*photo(?:graph)?(?!${letter})[^\])\n]*[\])]`,
].join('|');
// A CV's own name in Arabic script (the record usually holds the Latin form): two to four Arabic words that are a field
// of the first line, the value of a "Name:" or "الاسم:" label (on its line or the next), or a whole line next to a line
// the record's name matched.
// shortcut: an Arabic name elsewhere, or past the first 300 characters of its line, is removed only when the record
// holds it, and an email counts as a line the name matched only when a name part stands alone in it
// (sara.qahtani@, not alqahtani@); widen if pilot CVs need. The bound and the leading Arabic check keep the lookbehinds linear on long lines.
const ARABIC_WORDS = String.raw`\p{sc=Arabic}+(?:[ \t]+\p{sc=Arabic}+){1,3}`;
const FIELD_END = String.raw`(?=${GAP}(?:$|[\n·•|,،;–-]))`;
const arabicNameOf = (recordName: string) =>
  String.raw`(?=\p{sc=Arabic})(?:${[
    String.raw`(?<=^(?:\s*|[^\n]{0,300}[·•|,،;–-])${GAP})${ARABIC_WORDS}${FIELD_END}`,
    String.raw`(?<=${FIELD}(?:full name|name|الاسم الكامل|الاسم)[ \t]*[:：]${GAP}(?:\n${GAP})?)${ARABIC_WORDS}${FIELD_END}`,
    ...(recordName
      ? [
          String.raw`(?<=(?:^|\n)[^\n]{0,300}${recordName}[^\n]{0,300}\n${GAP})${ARABIC_WORDS}(?=${GAP}(?:$|\n))`,
          String.raw`(?<=(?:^|\n)${GAP})${ARABIC_WORDS}(?=${GAP}\n[^\n]*${recordName})`,
        ]
      : []),
  ].join('|')})`;

// Stands in for each character of an email while names, phones and traits are matched: a private-use character, never
// a letter, digit or separator, so no other pattern starts, ends or runs inside an email (AIV-P2-081). An email that
// holds a part of the candidate's name gets NAMED_MASK, so the Arabic-name rule still sees "a line the name matched".
// shortcut: a source that already holds U+E000 or U+E001 has it read as an email and replaced, and a stray U+E001
// makes the next Arabic line count as next to the name; both over-remove, nothing leaks. Strip them if that matters.
const MASK = '\uE000';
const NAMED_MASK = '\uE001';

/** Every email: the record's own (for any the generic shape would miss) and the generic shape. */
const emailsOf = ({ emails }: Identifiers) =>
  new RegExp([...emails.filter(Boolean).map(escape), EMAIL].join('|'), 'giu');

/** The record's name parts as patterns: `own` matches a non-particle part, `ownWord` one standing alone. */
function namePartsOf(names: readonly string[]) {
  const parts = [...new Set(names.flatMap((name) => name.trim().split(/[\s-]+/)))]
    .filter((part) => (part.match(/\p{L}/gu)?.length ?? 0) >= 2)
    .toSorted((a, b) => b.length - a.length);
  const alone = parts.filter((part) => !PARTICLES.has(part.toLowerCase()));
  const word = (list: string[]) => `(?:${list.map(escape).join('|')})(?!${letter})`;
  const particles = alone.length ? parts.filter((part) => !alone.includes(part)) : [];
  const own = word(alone.length ? alone : parts);
  // A whole name part, so "Ali" never matches in "Quality". Letter boundaries, not \b, which is ASCII-only.
  const ownWord = parts.length ? `(?<!${letter})${own}` : '';
  const lead = particles.length ? `(?:${word(particles)}[\\s-]+)*` : '';
  return { parts, own, ownWord, lead };
}

/** One pattern per source kind: `traits` for TRAIT_KINDS, and `cv` adds the Arabic name. */
function patternFor({ names, phones }: Identifiers, traits: boolean, cv: boolean): RegExp {
  const { parts, own, ownWord, lead } = namePartsOf(names);
  // A run of name parts ("Sara Al Qahtani", "Al-Qahtani's", split across lines) is one placeholder; it starts and ends
  // on a non-particle. Emails are masked before this runs (redactSources), so a run never reaches into one.
  const name = parts.length ? `(?<!${letter})${lead}${own}(?:[\\s-]+${lead}${own})*(?:['’]s(?!${letter}))?` : '';
  // The record's own phones match by their digits in any formatting, spaced dashes included, at any length.
  const record = phones
    .map((phone) => phone.replace(/\D/g, '').replace(/^00/, ''))
    .filter(Boolean)
    .map((digits) => `${DIAL}${[...digits].join(String.raw`[\s().\-–]{0,3}`)}${END}`);
  // Order matters: the record's own phones before the generic shape. Emails are found first and masked (emailsOf), so
  // here an email is one masked run and nothing else can match inside it.
  const alternatives = [
    `(?<email>[${MASK}${NAMED_MASK}]+)`,
    ...(record.length ? [`(?<own>${record.join('|')})`] : []),
    `(?<phone>${DOTTED}|${PHONE})`,
    ...(traits ? [`(?<trait>${TRAIT})`] : []),
    ...(cv ? [`(?<arabicName>${arabicNameOf(ownWord && `(?:${ownWord}|${NAMED_MASK})`)})`] : []),
    ...(name ? [`(?<name>${name})`] : []),
  ];
  return new RegExp(alternatives.join('|'), 'giu');
}

/** Where an offset in the redacted text, never inside a placeholder, falls in the original. */
function toOriginal(cuts: readonly Cut[], offset: number): number {
  let shift = 0;
  for (const cut of cuts) {
    if (offset < cut.at + cut.length) break;
    shift = cut.from + cut.fromLength - cut.at - cut.length;
  }
  return offset + shift;
}

export type Redaction = {
  /** The sources as the model sees them, in the same order. */
  sources: Source[];
  /**
   * A span of the redacted `sources[index]` as a span of the original source text, cut to its longest stretch with no
   * placeholder so no name, email or phone comes back as a stored quote; undefined when it touches a removed trait, so a
   * protected trait never comes back either, or when no word is left once the placeholders are cut away.
   */
  original(index: number, span: { start: number; end: number }): { start: number; end: number } | undefined;
};

/**
 * Replaces the candidate's name parts (and possessives) with `[CANDIDATE]`, and every email and phone with
 * `[EMAIL_n]` and `[PHONE_n]`, numbered per call so the same value always gets the same placeholder. With
 * `keepContact`, emails and phones stay as written.
 */
export function redactSources(sources: readonly Source[], identifiers: Identifiers, keepContact: boolean): Redaction {
  const plain = patternFor(identifiers, false, false);
  const traits = patternFor(identifiers, true, false);
  const cv = patternFor(identifiers, true, true);
  const emailPattern = emailsOf(identifiers);
  const { ownWord } = namePartsOf(identifiers.names);
  const named = ownWord ? new RegExp(ownWord, 'iu') : null;
  const mask = (email: string) => (named?.test(email) ? NAMED_MASK : MASK).repeat(email.length);
  const patternOf = (kind: Source['kind']) => (kind === 'cv' ? cv : TRAIT_KINDS.has(kind) ? traits : plain);
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
    const masked = source.text.replace(emailPattern, mask);
    for (const match of masked.matchAll(patternOf(source.kind))) {
      const value = source.text.slice(match.index, match.index + match[0].length);
      const { email, own, phone, trait } = match.groups ?? {};
      let to = trait ? PROTECTED_PLACEHOLDER : CANDIDATE_PLACEHOLDER;
      if (email || own || phone) {
        if (phone && (!phoneShaped(value) || yearsOrDate.test(value))) continue;
        if (keepContact) continue;
        to = email
          ? numbered('EMAIL', value.toLowerCase())
          : numbered('PHONE', value.replace(/\D/g, '').replace(/^00/, ''));
      }
      text += source.text.slice(last, match.index);
      cuts.push({ at: text.length, length: to.length, from: match.index, fromLength: value.length, trait: !!trait });
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
      if (cuts.some((cut) => cut.trait && start < cut.at + cut.length && end > cut.at)) return undefined;
      // A quote never brings an identifier back (AIV-P2-080): keep its longest stretch between placeholders.
      const text = redacted[index]?.text ?? '';
      let best = { start, end: start };
      let from = start;
      for (const cut of [...cuts.filter((c) => c.at < end && c.at + c.length > start), { at: end, length: 0 }]) {
        let [s, e] = [from, Math.min(cut.at, end)];
        while (s < e && EDGE.test(text[s] ?? '')) s++;
        while (e > s && EDGE.test(text[e - 1] ?? '')) e--;
        if (e - s > best.end - best.start) best = { start: s, end: e };
        from = Math.max(from, cut.at + cut.length);
      }
      // A stretch with no word left ("(", "'") would cite nothing.
      if (!/[\p{L}\p{N}]/u.test(text.slice(best.start, best.end))) return undefined;
      return { start: toOriginal(cuts, best.start), end: toOriginal(cuts, best.end) };
    },
  };
}

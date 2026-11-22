// CV parsing (AIV-P1-025): pure rules over Document Intelligence's layout and the model's checked extraction. A CV says
// what someone claims and never proves it, so every item made here is "Claim awaiting validation", strength Claim only.
// Every excerpt is the CV's own text, sliced from it by offset, so nothing here can add a word the CV does not have.
// The date and skill repair passes are adapted from Resume-Matcher's `restore_dates_from_markdown` and
// `restore_skills_from_markdown` (Apache-2.0, modified): THIRD_PARTY_NOTICES.md.
import type { UnusualContent } from '@credalent/ai';
import type { EvidenceItem } from './evidence.ts';
import { parseRepositoryUrl } from './repository.ts';

/** `waiting`: the workspace's daily AI budget is spent and the parse is scheduled for the next UTC day (AIV-P1-089). */
export const CV_PARSE_STATUSES = ['pending', 'waiting', 'parsed', 'unreadable', 'failed'] as const;
export type CvParseStatus = (typeof CV_PARSE_STATUSES)[number];

const NOT_A_NAME =
  /\b(curriculum|vitae|resume|résumé|cv|profile|summary|contact|about|personal|experience|education|skills|objective|engineer|developer|manager|designer|analyst|scientist|consultant|architect|director|lead|senior|junior|intern|specialist|officer|united|emirates|arab|saudi|kingdom|dubai|riyadh|abu|dhabi)\b/iu;
const PARTICLE = /^(?:bin|bint|ben|ibn|van|von|de|del|da|di|al|el)$/u;
const NAME_WORD = /^(?!\p{Ll})\p{L}[\p{L}\p{M}'’.-]*$/u;

/**
 * The applicant's name, read locally from the first lines of the CV (two to four words of letters, none starting in
 * lower case), so it is known before any text goes to the model (AIV-P1-090). Null when no line looks like a name.
 */
// shortcut: a name that is not alone on one of the first six lines is not found (the parse then fails closed), and a
// non-name line of two to four capitalised words that avoids the deny list above can be taken for one (it then renames the
// applicant and redacts the wrong words); upgrade to corroborating the name with the CV's email address, or a name-only
// pass, if pilot CVs show either.
export function nameFromCv(text: string): string | null {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6);
  const line = lines.find((l) => {
    const words = l.split(/\s+/);
    return (
      words.length >= 2 &&
      words.length <= 4 &&
      !NOT_A_NAME.test(l) &&
      NAME_WORD.test(words[0] ?? '') &&
      NAME_WORD.test(words.at(-1) ?? '') &&
      words.every((w) => NAME_WORD.test(w) || PARTICLE.test(w))
    );
  });
  return line ? line.split(/\s+/).join(' ') : null;
}

/** Why a note was raised: `detectUnusualContent`'s reasons and `hidden_text` (below). */
export const NOTE_REASONS = ['instruction', 'role_marker', 'tool_call', 'hidden_text'] as const;
export type NoteReason = UnusualContent['reason'];

/** The citation label of a CV source; an item's span reads "page N", so the screen shows "CV, page N". */
export const CV_LABEL = 'CV';
export const CV_LIMIT = 'CV statement only; nothing to inspect yet.';

type Span = { offset: number; length: number };

/** The part of Document Intelligence's layout result this module reads (infrastructure zod-checks it). */
export type CvLayout = {
  /** The whole document's text; every offset below indexes it. */
  content: string;
  pages: {
    pageNumber: number;
    /** `inch` for PDF, `pixel` for images; Word documents have no polygons. */
    unit: string;
    spans: Span[];
    lines: { content: string; polygon: number[]; spans: Span[] }[];
  }[];
  /** Font styles (`features=styleFont`); colours are `#rrggbb`. */
  styles: { color: string | null; backgroundColor: string | null; spans: Span[] }[];
};

/** "Unusual content in this source" on a CV source: why, the CV text it quotes, and "page N". */
export type SourceNote = {
  id: string;
  workspaceId: string;
  sourceId: string;
  candidateId: string;
  reason: NoteReason;
  excerpt: string;
  excerptSpan: string | null;
  createdAt: Date;
};

const end = (s: Span) => s.offset + s.length;
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && b.start < a.end;

/** The page the offset falls on, or null. */
export const pageAt = (layout: Pick<CvLayout, 'pages'>, offset: number): number | null =>
  layout.pages.find((p) => p.spans.some((s) => offset >= s.offset && offset < end(s)))?.pageNumber ?? null;

/** The item and note span, "page 2"; the screen prefixes the source label ("CV, page 2"). */
export const pageSpan = (layout: Pick<CvLayout, 'pages'>, offset: number): string | null => {
  const page = pageAt(layout, offset);
  return page === null ? null : `page ${page}`;
};

/** True when the bytes are what the content type says: a PDF starts `%PDF-`, a Word document is a zip (`PK`). */
export function looksLike(contentType: string, data: Uint8Array): boolean {
  const head = String.fromCharCode(...data.subarray(0, 5));
  if (contentType === 'application/pdf') return head === '%PDF-';
  if (contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    return head.startsWith('PK\x03\x04');
  return false;
}

// --- Hidden text ------------------------------------------------------------------------------------------------

/** Text shorter than 4 pt is not meant to be read. */
const MIN_TEXT_HEIGHT_INCH = 4 / 72;
/** RGB distance under which text is taken to be the background's colour (#f4f4f4 on white is 19). */
const NEAR_BACKGROUND = 48;

const rgb = (hex: string | null) => {
  const m = hex && /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [m[1], m[2], m[3]].map((h) => parseInt(h ?? '0', 16)) : null;
};

function nearBackground(style: CvLayout['styles'][number]): boolean {
  const fg = rgb(style.color);
  // shortcut: a style with no background is taken to sit on white, the page colour of nearly every CV; read the page
  // image's colour if a pilot CV hides text on a coloured page.
  const bg = rgb(style.backgroundColor ?? '#ffffff');
  if (!fg || !bg) return false;
  return Math.hypot(...fg.map((c, i) => c - (bg[i] ?? 0))) < NEAR_BACKGROUND;
}

/**
 * Lines a reader cannot see: font colour near the background, or shorter than 4 pt. One `hidden_text` finding per line,
 * quoting the line. The text itself stays in the CV text and is extracted like any other statement (a claim).
 */
export function hiddenText(layout: CvLayout): UnusualContent[] {
  const faint = layout.styles
    .filter(nearBackground)
    .flatMap((s) => s.spans.map((x) => ({ start: x.offset, end: end(x) })));
  const found: UnusualContent[] = [];
  for (const page of layout.pages)
    for (const line of page.lines) {
      const first = line.spans[0];
      const last = line.spans.at(-1);
      if (!first || !last) continue;
      const span = { start: first.offset, end: end(last) };
      const ys = line.polygon.filter((_, i) => i % 2 === 1);
      // shortcut: size is measured only where Document Intelligence gives inches (PDF); pixels need the image's DPI.
      const tiny = page.unit === 'inch' && ys.length >= 2 && Math.max(...ys) - Math.min(...ys) < MIN_TEXT_HEIGHT_INCH;
      if (tiny || faint.some((f) => overlaps(f, span)))
        found.push({ reason: 'hidden_text', excerpt: line.content, start: span.start, end: span.end });
    }
  return found;
}

/** The notes to store: every hidden line, and each other finding that is not inside one (one note per text). */
export const mergeNotes = (found: readonly UnusualContent[], hidden: readonly UnusualContent[]): UnusualContent[] =>
  [...hidden, ...found.filter((f) => !hidden.some((h) => overlaps(f, h)))].toSorted((a, b) => a.start - b.start);

// --- Repair passes ----------------------------------------------------------------------------------------------

const MONTH =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const HAS_MONTH = new RegExp(`\\b${MONTH}\\b`, 'i');
const MONTH_DATE = new RegExp(
  `\\b${MONTH}\\.?\\s+\\d{4}(?:\\s*[-–—]\\s*(?:${MONTH}\\.?\\s+\\d{4}|Present|Current|Now|Ongoing))?`,
  'gi',
);
/** How far from the role's line a date may be and still be that role's (one or two lines). */
const DATE_WINDOW = 200;

/** "2020 - 2023", "2021 - current": the years and whether it runs to now, so differently written dates compare. */
function yearsKey(value: string): string {
  const years = value.match(/\d{4}/g) ?? [];
  const current = /\b(?:present|current|now|ongoing)\b/i.test(value);
  const unique = !current && years.length === 2 && years[0] === years[1] ? years.slice(0, 1) : years;
  return [...unique, ...(current ? ['current'] : [])].join(' - ');
}

type Located = { value: string; start: number; end: number };

/**
 * SAFETY: the one way a value enters an item: found verbatim in `text` between `from` and `to`, and returned as that
 * slice. A value the model reworded ("LangChain" citing "LangGraph") is not found and adds nothing (AGENTS.md 1.6).
 */
export function inSource(text: string, value: string, from: number, to: number): Located | null {
  const at = value ? text.indexOf(value, Math.max(0, from)) : -1;
  if (at < 0 || at + value.length > to) return null;
  return { value: text.slice(at, at + value.length), start: at, end: at + value.length };
}

/**
 * The role's dates as the CV writes them, near the role's line: the model's own dates when they are in the CV, or, when
 * the model wrote years only, the nearest month-inclusive date in the CV with the same years ("2020 - 2023" ->
 * "Jun 2020 - Aug 2023"); "Present" stays. Null when the CV has neither.
 */
export function restoreDate(text: string, dates: string | null, role: { start: number; end: number }): Located | null {
  if (!dates) return null;
  const from = role.start - DATE_WINDOW;
  const to = role.end + DATE_WINDOW;
  const own = inSource(text, dates, from, to);
  if (HAS_MONTH.test(dates)) return own;
  const key = yearsKey(dates);
  const near = [...text.matchAll(MONTH_DATE)]
    .filter((m) => m.index >= from && m.index + m[0].length <= to && key && yearsKey(m[0]) === key)
    // A role's dates follow its line on most CVs, so a date after the role wins over a nearer one before it.
    .toSorted(
      (a, b) =>
        Number(a.index < role.start) - Number(b.index < role.start) ||
        Math.abs(a.index - role.start) - Math.abs(b.index - role.start),
    )[0];
  return near ? inSource(text, near[0], near.index, near.index + near[0].length) : own;
}

const MIN_LIST_ITEMS = 3;
const MIN_ANCHORS = 2;
const MAX_ITEM_WORDS = 5;
const MAX_ITEM_CHARS = 40;
const MAX_LINE_ITEMS = 200;
const PROSE_WORDS = new Set(['with', 'for', 'to', 'the', 'of', 'in', 'on', 'using', 'by', 'from', 'at', 'into']);
const NAME_CONNECTORS = new Set(['on', 'of', 'the', 'in', 'for']);
const HEADING =
  /^(?:(?:technical|core|key|other)\s+)?(?:skills?|technologies|tools|frameworks?|platforms?|tech(?:nology)?\s+stack|stack)$/i;

/** "Built services with Python" is prose; "Ruby on Rails" is a name: every other word capitalised. */
function isProse(words: string[]): boolean {
  const fn = words.map((w) => w.toLowerCase()).filter((w) => PROSE_WORDS.has(w));
  if (!fn.length) return false;
  if (fn.some((w) => !NAME_CONNECTORS.has(w))) return true;
  return !words.filter((w) => !PROSE_WORDS.has(w.toLowerCase())).every((w) => !/^\p{L}/u.test(w) || /^\p{Lu}/u.test(w));
}

/** Splits `value` on `separator` (a global regex), each piece trimmed, with its offset in the CV text. */
function split(value: string, base: number, separator: RegExp): Located[] {
  const pieces: Located[] = [];
  let at = 0;
  for (const [from, to] of [
    ...[...value.matchAll(separator)].map((m) => [m.index, m.index + m[0].length]),
    [value.length, value.length],
  ]) {
    const part = value.slice(at, from);
    const lead = part.length - part.trimStart().length;
    const piece = part.trim();
    if (piece) pieces.push({ value: piece, start: base + at + lead, end: base + at + lead + piece.length });
    at = to ?? value.length;
  }
  return pieces;
}

/** The items of a list line of short items ("Skills: Python, TypeScript and Go"), or [] when the line is not one. */
function listItems(line: string, base: number): Located[] {
  const label = /^\s*(?:[-*+●▪◦‣]|\d+[.)])?\s*(?:[^:,]{1,80}:\s*)?/.exec(line)?.[0].length ?? 0;
  // Spoken languages are not skills, even beside one ("Languages: English, Arabic, Python").
  if (/^\s*(?:spoken\s+)?languages?\s*:/i.test(line)) return [];
  if ((line.match(/[,|;•·]/g)?.length ?? 0) >= MAX_LINE_ITEMS) return [];
  let items = split(line.slice(label), base + label, /[,|;•·]/g).map((i) => {
    const value = i.value.replace(/\.$/, '').trimEnd(); // "Go." ends a line; ".NET" keeps its dot
    return { ...i, value, end: i.start + value.length };
  });
  if (items[0] && HEADING.test(items[0].value)) items = items.slice(1);
  // A conjunction left dangling means a sentence wrapped across lines, not a list.
  if (items.some((i) => /\s(?:and|or|&)$/i.test(i.value) || /^(?:and|or|&)$/i.test(i.value))) return [];
  const last = items.pop();
  if (last) {
    const opener = /^(?:and|or|&)\s+/i.exec(last.value)?.[0].length ?? 0;
    const rest = { value: last.value.slice(opener), start: last.start + opener, end: last.end };
    // "Rust and Go" closes a list with two skills; "Drag & Drop" stays one.
    items.push(...split(rest.value, rest.start, /\s+(?:and|or)\s+/gi));
  }
  if (items.slice(0, -1).some((i) => /^(?:and|or|&)\s/i.test(i.value))) return [];
  if (items.length < MIN_LIST_ITEMS) return [];
  const ok = items.every((i) => {
    const words = i.value.split(/\s+/);
    return (
      i.value.length <= MAX_ITEM_CHARS && words.length <= MAX_ITEM_WORDS && !/@|:\/\//.test(i.value) && !isProse(words)
    );
  });
  return ok ? items : [];
}

/**
 * Skills the model dropped from a list line: a line that is a list of at least 3 short items, at least 2 of which the
 * model extracted, gives back its other items, in CV order, each a slice of the CV. Prose, locations and spoken
 * languages are never anchored by 2 extracted skills, so they stay untouched.
 */
export function restoreSkills(text: string, extracted: readonly string[]): Located[] {
  const anchors = new Set(extracted.map((s) => s.toLowerCase()));
  const known = new Set(anchors);
  const restored: Located[] = [];
  let base = 0;
  for (const line of text.split('\n')) {
    const items = listItems(line, base);
    base += line.length + 1;
    if (items.filter((i) => anchors.has(i.value.toLowerCase())).length < MIN_ANCHORS) continue;
    for (const item of items) {
      if (known.has(item.value.toLowerCase())) continue;
      known.add(item.value.toLowerCase());
      const found = inSource(text, item.value, item.start, item.end);
      if (found) restored.push(found);
    }
  }
  return restored;
}

// --- Claims -----------------------------------------------------------------------------------------------------

type Cite = { start: number; end: number; quote: string };

/** The model's answer after the citation contract (`parseCvSchema` of @credalent/ai, checked). */
export type CvExtraction = {
  contact: { emails: string[]; phones: string[] };
  workHistory: { role: string; dates: string | null; citations: Cite[] }[];
  skills: { skill: string; citations: Cite[] }[];
  statements: { text: string; citations: Cite[] }[];
};

export type CvClaim = Pick<EvidenceItem, 'excerpt' | 'excerptSpan' | 'provenance' | 'strength' | 'limit'>;

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
// A phone in international (+971 50 ...) or local (050 123 4567) form; a local number has no dots, so a European date
// range (06.2020 - 08.2023) is not one.
const PHONE = /\+\s?\d[\d\s().-]{6,}\d|\b0\d{1,3}[\s-]?\d{3}[\s-]?\d{3,4}\b/;

/**
 * Every statement, role and skill as a claim, CV order, after the repair passes. Left out: anything inside text aimed at
 * the AI (`instructions`, from `detectUnusualContent`), and any excerpt holding contact details, which go to the
 * candidate record only (AGENTS.md 1.2). `contact` keeps only values the CV writes verbatim.
 */
export function cvClaims(
  extraction: CvExtraction,
  layout: CvLayout,
  instructions: readonly { start: number; end: number }[],
): { claims: CvClaim[]; contact: { emails: string[]; phones: string[] } } {
  const text = layout.content;
  const contact = {
    emails: extraction.contact.emails.filter((e) => e && text.includes(e)),
    phones: extraction.contact.phones.filter((p) => p && text.includes(p)),
  };
  const contacts = [...contact.emails, ...contact.phones];
  const found: Located[] = [];
  // A statement repeating the CV's own contact is dropped whole: contact goes to the candidate record only (AIV-P1-080).
  for (const s of extraction.statements.filter((statement) => !contacts.some((c) => statement.text.includes(c))))
    for (const c of s.citations.slice(0, 1)) found.push({ value: c.quote, ...c });
  for (const w of extraction.workHistory)
    for (const c of w.citations.slice(0, 1)) {
      const date = restoreDate(text, w.dates, c);
      const start = Math.min(c.start, date?.start ?? c.start);
      const stop = Math.max(c.end, date?.end ?? c.end);
      found.push({ value: text.slice(start, stop), start, end: stop });
    }
  const skills = extraction.skills.flatMap((s) =>
    s.citations.slice(0, 1).flatMap((c) => inSource(text, s.skill, c.start, c.end) ?? []),
  );
  found.push(
    ...skills,
    ...restoreSkills(
      text,
      skills.map((s) => s.value),
    ),
  );

  const seen = new Set<string>();
  const claims = found
    .filter((f) => !instructions.some((i) => overlaps(i, f)))
    .filter((f) => !EMAIL.test(f.value) && !PHONE.test(f.value) && !contacts.some((c) => f.value.includes(c)))
    .toSorted((a, b) => a.start - b.start)
    .filter((f) => !seen.has(`${f.start}:${f.value}`) && seen.add(`${f.start}:${f.value}`))
    .map((f): CvClaim => ({
      excerpt: f.value,
      excerptSpan: pageSpan(layout, f.start),
      provenance: 'claim',
      strength: 'claim',
      limit: CV_LIMIT,
    }));
  return { claims, contact };
}

const GITHUB_LINK = /\b(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}/gi;

/**
 * The GitHub repository links the CV writes, as https://github.com/<owner>/<repo>, once each, CV order; a link inside
 * text aimed at the AI (`instructions`) is left out, so an injected "verify at github.com/..." queues nothing.
 */
export function repositoryLinks(text: string, instructions: readonly { start: number; end: number }[]): string[] {
  const links = [...text.matchAll(GITHUB_LINK)]
    .filter((m) => !instructions.some((i) => overlaps(i, { start: m.index, end: m.index + m[0].length })))
    .flatMap((m) => {
      const repo = parseRepositoryUrl(
        `https://${m[0]
          .replace(/^https?:\/\//i, '')
          .replace(/^www\./i, '')
          .replace(/\.$/, '')}`,
      );
      return repo ? [`https://github.com/${repo.owner}/${repo.name}`] : [];
    });
  return [...new Set(links)];
}

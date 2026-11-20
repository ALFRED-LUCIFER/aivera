// MIT License. Copyright (c) 2026 Santiago Fernández de Valderrama. Ported to TypeScript and changed for Credalent
// (two sources compared both ways, thousands separators, headcount nouns, plural-folded context words); the licence
// text is in THIRD_PARTY_NOTICES.md.
//
// The numeric pre-check before any AI contradiction comparison (AIV-P1-029). Pure and deterministic. Two numbers are
// compared only when they count the same unit and their sentences share enough context words; a digit coincidence
// elsewhere ("12 years of experience" against "a 12-person team") is never compared. Numbers in words ("a few
// hundred") and ranges are left to the AI comparison.

/**
 * `contradiction`: a scoped number differs ("12 engineers" against "managed 5 engineers"). `agreement`: the scoped
 * numbers match. `not_settled`: the other source speaks about the same thing with no comparable number, so only the
 * AI comparison can judge. `not_compared`: nothing in the two shares a unit and context.
 */
export type PrecheckOutcome = 'contradiction' | 'agreement' | 'not_settled' | 'not_compared';

const HOUR_UNITS = new Set(['h', 'hr', 'hrs', 'hour', 'hours']);
// A headcount in any of these words is one unit: "a team of 12 engineers" and "a 12-person team" count the same thing.
const PERSON_UNITS = new Set([
  'person',
  'persons',
  'people',
  'member',
  'members',
  'engineer',
  'engineers',
  'developer',
  'developers',
  'staff',
  'employee',
  'employees',
]);
// Units that say how much but not of what: they need METRIC_CONTEXT_WORDS shared words, and their own words never count.
const UNITS_WITHOUT_METRIC = new Set(['%', 'hour']);
const UNIT_WORDS = new Set([...HOUR_UNITS, 'hour', 'percent', 'cent']);
const METRIC_CONTEXT_WORDS = 2;

// Connective words that would otherwise manufacture shared context.
const STOPWORDS = new Set([
  'this', 'that', 'these', 'those', 'with', 'from', 'into', 'onto', 'over', 'were', 'have', 'while', 'about', 'their',
  'there', 'which', 'through', 'across', 'within', 'without', 'after', 'before', 'during', 'being', 'been', 'each',
  'every', 'other', 'than', 'then', 'them', 'they', 'when', 'where', 'what', 'more', 'most', 'some', 'such', 'only',
  'also', 'just', 'like', 'very', 'used', 'using',
]); // prettier-ignore

// Words that never name what a number counts: "in 2019 the team", "3 and".
const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'by', 'for', 'as', 'is', 'was', 'were', 'with', 'from',
  'that', 'this', 'it', 'its', 'but', 'so', 'if', 'than', 'then', 'into', 'over', 'per',
]); // prettier-ignore
// A four-digit year is a date, not a count. A real count in that range ("2000 merchants") is skipped too and falls to
// `not_settled`, so the AI comparison judges it.
const YEAR_RE = /^(?:19|20)\d{2}$/u;

// A number not glued to a letter or digit ("Q3", "v2"), with thousands separators ("9,000").
const NUMBER_RE = /(?<![\p{L}\p{N}])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/gu;

/** One spelling per unit: every hour spelling `hour`, every headcount word `person`, otherwise a plural `s` dropped. */
function normalizeUnit(word: string): string {
  const w = word.toLowerCase();
  if (HOUR_UNITS.has(w)) return 'hour';
  if (PERSON_UNITS.has(w)) return 'person';
  return w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
}

/** NFKC, lowercased, without the combining dot a lowercased Turkish `İ` leaves, so both sides fold alike. */
const fold = (text: string) => text.normalize('NFKC').toLowerCase().replace(/̇/gu, '');

/** `%` (or "percent"), or the next word through a hyphen or `+`; null when nothing unit-like follows ("2019 – 2024"). */
function unitAfter(text: string, end: number): string | null {
  const after = fold(text.slice(end, end + 40));
  if (/^\s?(?:%|per\s?cent\b)/u.test(after)) return '%';
  const word = /^(?:-|\+?\s*)(\p{L}+)/u.exec(after);
  return word?.[1] && !FUNCTION_WORDS.has(word[1]) ? normalizeUnit(word[1]) : null;
}

/** The sentence around [start, end): to the previous and next line break or `.`, `!`, `?` before whitespace. */
function sentenceBounds(text: string, start: number, end: number) {
  const isEnd = (i: number) =>
    text[i] === '\n' || (/[.!?]/u.test(text[i] ?? '') && (i + 1 >= text.length || /\s/u.test(text[i + 1] ?? '')));
  let s = start;
  while (s > 0 && !isEnd(s - 1)) s--;
  let e = end;
  while (e < text.length && !isEnd(e)) e++;
  return { start: s, end: e };
}

/** Content words of a sentence in any script: 4+ letters, not a stopword, not a number; plurals folded like units. */
function contextWords(sentence: string): string[] {
  const words = fold(sentence)
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .split(/\s+/u)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !/^\p{N}+$/u.test(w));
  return [...new Set(words.map(normalizeUnit))];
}

type NumberFact = { value: number; unit: string; sentence: number; words: string[] };

/** Every number in `text` that counts a unit, with its sentence (by start index) and that sentence's context words. */
function numbersIn(text: string): NumberFact[] {
  const facts: NumberFact[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const end = m.index + m[0].length;
    const unit = unitAfter(text, end);
    if (!unit || (unit !== '%' && YEAR_RE.test(m[0]))) continue;
    const { start, end: sentenceEnd } = sentenceBounds(text, m.index, end);
    facts.push({
      value: Number.parseFloat(m[0].replaceAll(',', '')),
      unit,
      sentence: start,
      words: contextWords(text.slice(start, sentenceEnd)),
    });
  }
  return facts;
}

/** Sentences of `text` with their context words. */
const sentencesIn = (text: string) =>
  text
    .split(/\n|(?<=[.!?])\s/u)
    .map(contextWords)
    .filter((w) => w.length > 0);

/**
 * Enough shared context for `unit`: two words naming the metric for a percentage or a duration, otherwise one. The unit
 * noun itself counts only for a headcount, or when the other side has no comparable number (`unitCounts`).
 */
// shortcut: a headcount compares on the unit alone ("hired 12 engineers" against "mentored 5 engineers" contradicts), as
// the ticket's "led a team of 12 engineers" against "managed 5 engineers" needs; a person resolves a false one. Narrow
// it if pilot resolutions show many.
function sharesContext(unit: string, a: readonly string[], b: readonly string[], unitCounts = unit === 'person') {
  const needed = UNITS_WITHOUT_METRIC.has(unit) ? METRIC_CONTEXT_WORDS : 1;
  return a.filter((w) => b.includes(w) && !UNIT_WORDS.has(w) && (unitCounts || w !== unit)).length >= needed;
}

/**
 * A number with no comparable partner whose topic the other source states in words: "9,000 merchants" against "a few
 * hundred merchants".
 */
const unsettled = (own: NumberFact[], others: NumberFact[], otherText: string) =>
  own.some(
    (x) =>
      !others.some((y) => y.unit === x.unit && sharesContext(x.unit, x.words, y.words)) &&
      sentencesIn(otherText).some((words) => sharesContext(x.unit, x.words, words, true)),
  );

/**
 * Compares the numbers of two excerpts. Per pair of sentences and unit holding comparable numbers (same unit, shared context),
 * the values agree when the two sets share one ("71% → 88%" agrees with "reached 88%") and contradict otherwise.
 * A contradiction anywhere wins; then a number the other side speaks about only in words (left to the AI); then an
 * agreement; otherwise nothing was compared.
 */
export function precheckNumbers(first: string, second: string): PrecheckOutcome {
  const a = numbersIn(first);
  const b = numbersIn(second);
  const pairs = new Map<string, { a: Set<number>; b: Set<number> }>();
  for (const x of a)
    for (const y of b) {
      if (x.unit !== y.unit || !sharesContext(x.unit, x.words, y.words)) continue;
      // Per unit too: a shared "30%" must not make "5 engineers" agree with "12 engineers".
      const key = `${x.sentence}:${y.sentence}:${x.unit}`;
      const pair = pairs.get(key) ?? { a: new Set(), b: new Set() };
      pair.a.add(x.value);
      pair.b.add(y.value);
      pairs.set(key, pair);
    }
  const verdicts = [...pairs.values()].map((p) => ([...p.a].some((v) => p.b.has(v)) ? 'agreement' : 'contradiction'));
  if (verdicts.includes('contradiction')) return 'contradiction';
  if (unsettled(a, b, second) || unsettled(b, a, first)) return 'not_settled';
  return verdicts.length ? 'agreement' : 'not_compared';
}

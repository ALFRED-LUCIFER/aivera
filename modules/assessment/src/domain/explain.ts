// The facts behind a ranking explanation (AIV-P1-033), from a stored snapshot and the evidence it cites. Pure: every
// number the recruiter reads is filled in here from the snapshot, never written by the model (AGENTS.md 1.6, 1.7).
import type { EvidenceItemView } from '@credalent/evidence';
import type { Assessment } from './assess.ts';

/** The id of the facts source among the sources the model reads; evidence items use their own ids. */
export const FACTS_ID = 'facts';

/** What a statement rests on: the snapshot's facts (`itemId` null) or an evidence item, with the exact words quoted. */
export type ExplanationCitation = { itemId: string | null; label: string; quote: string };
export type ExplanationStatement = { text: string; citations: ExplanationCitation[] };

/** One piece of text the model may cite: the facts, or one cited evidence item's excerpt. */
export type ExplainSource = {
  id: string;
  label: string;
  kind: EvidenceItemView['source']['kind'] | 'facts';
  text: string;
};

export type Facts = {
  /** Placeholder to the text that replaces it; a placeholder with no entry has no fact behind it. */
  values: Record<string, string>;
  /** How many competencies rest on independently checked work, and how many on claims. */
  counts: { checked: number; claims: number };
  /** The checked competencies are the heaviest of the rubric: the only case a statement may say "heaviest". */
  heaviest: boolean;
  /**
   * The facts source, one line per fact, with a placeholder where a figure or the claims' names stand, so a line the
   * model copies is a statement it may write (AIV-P1-132); null when the snapshot has nothing to explain.
   */
  factsText: string | null;
  /** The evidence items the backed score rests on, heaviest competency first, each with the competency it backs. */
  items: (ExplainSource & { competency: string })[];
};

// shortcut: at most 8 excerpts go to the model, the heaviest competencies' first, to bound the prompt; raise it if a
// pilot job's explanation leaves a heavy competency's evidence out.
const MAX_ITEMS = 8;

const weight = (cs: { weightPercent: number }[]) => cs.reduce((sum, c) => sum + c.weightPercent, 0);

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const competenciesText = (n: number) => `${WORDS[n] ?? String(n)} ${n === 1 ? 'competency' : 'competencies'}`;
// A name that holds an "and" ("Cost and reliability") is followed by ", and" even for two names, so the list reads clearly.
const listText = (names: string[]) =>
  names.length < 3 && !names.some((n) => n.includes(' and '))
    ? names.join(' and ')
    : `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;

/**
 * Facts from the latest snapshot: the weight resting on independently checked work (a corroborated item among those the
 * proven level cites), the weight still resting on claims (a claimed level above the proven one), and the cited items.
 * `names` are the approved rubric's competency names by id.
 */
export function factsOf(
  assessment: Assessment,
  names: ReadonlyMap<string, string>,
  evidence: readonly EvidenceItemView[],
): Facts {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const nameOf = (c: { competencyId: string }) => names.get(c.competencyId) ?? 'an unnamed competency';
  const checked = assessment.competencies.filter(
    (c) => c.proven.level > 0 && c.proven.itemIds.some((id) => byId.get(id)?.provenance === 'corroborated'),
  );
  const claims = assessment.competencies.filter((c) => c.claimedLevel > c.proven.level);

  const values: Record<string, string> = {};
  let heaviest = false;
  const lines: string[] = [];
  if (checked.length > 0) {
    values['checkedCompetencies'] = competenciesText(checked.length);
    values['checkedWeight'] = `${weight(checked)}%`;
    const others = assessment.competencies.filter((c) => !checked.includes(c));
    heaviest =
      others.length === 0 ||
      Math.min(...checked.map((c) => c.weightPercent)) >= Math.max(...others.map((c) => c.weightPercent));
    const noun = checked.length === 1 ? 'competency' : 'competencies';
    lines.push(
      `Independently checked work backs ${heaviest ? `the heaviest ${noun}` : `${checked.length === 1 ? 'this' : 'these'} ${noun}`}: ${listText(checked.map(nameOf))}, {checkedWeight} of the weight.`,
    );
  }
  if (claims.length > 0) {
    values['claimCompetencies'] = competenciesText(claims.length);
    values['claimWeight'] = `${weight(claims)}%`;
    values['claimNames'] = listText(claims.map(nameOf));
    lines.push('Still resting on claims: {claimNames}, {claimWeight} of the weight.');
  }

  const seen = new Set<string>();
  const items = assessment.competencies
    .toSorted((a, b) => b.weightPercent - a.weightPercent)
    .flatMap((c) => c.proven.itemIds.map((id) => ({ id, competency: nameOf(c) })))
    .flatMap(({ id, competency }) => {
      const item = byId.get(id);
      if (!item || seen.has(id)) return [];
      seen.add(id);
      return [{ id, competency, label: item.source.label, kind: item.source.kind, text: item.excerpt }];
    })
    .slice(0, MAX_ITEMS);

  return {
    values,
    heaviest,
    counts: { checked: checked.length, claims: claims.length },
    factsText: lines.length > 0 ? lines.join('\n') : null,
    items,
  };
}

/** The text with each placeholder replaced from the snapshot, or null when it holds one the snapshot has no fact for. */
function resolve(text: string, values: Readonly<Record<string, string>>): string | null {
  let missing = false;
  const filled = text.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (value === undefined) missing = true;
    return value ?? '';
  });
  return missing ? null : filled;
}

/**
 * The statement's text with each placeholder replaced from the snapshot and the first letter capitalised, or null when
 * it holds a placeholder the snapshot has no fact for (such a statement is dropped, never shown with a blank).
 */
export const fill = (text: string, values: Readonly<Record<string, string>>): string | null =>
  resolve(text, values)?.replace(/^\s*\p{L}/u, (c) => c.toUpperCase()) ?? null;

const HEAVIEST = /\b(?:heaviest|largest share|most weighted|biggest)\b/i;
// Rule 1.6: nothing is called verified or proven (only a second independent source "checks"), and a claim is never
// described as checked, backed or supported.
const OVERSTATES = /\bverif|\bproven\b|\bconfirm/i;
const CLAIM_CREDIT = /\b(?:back(?:s|ed|ing)?|check(?:s|ed)?|support(?:s|ed)?)\b/i;

/**
 * Whether a model statement may be shown, judged on `raw`, the model's own words with its placeholders unfilled (a
 * filled-in competency name such as "Test and verification" is a server fact, not the model's claim): it says "heaviest"
 * only when the facts do and not of a claim, never calls anything verified, proven or confirmed, and never says a claim
 * is checked, backed or supported.
 */
// shortcut: a competency name the model writes out literally, instead of through its placeholder, is not checked here;
// the live judge's rubric ("says only what its source shows") is the backstop. Check names against the rubric if it slips.
export const statementAllowed = (raw: string, facts: Pick<Facts, 'heaviest'>): boolean => {
  const aboutClaims = /\{claim\w*\}/.test(raw);
  return (
    !OVERSTATES.test(raw) &&
    !(HEAVIEST.test(raw) && (!facts.heaviest || aboutClaims)) &&
    !(aboutClaims && CLAIM_CREDIT.test(raw))
  );
};

/**
 * What a statement cites for a source of the explanation: the evidence item, or the facts line (no item id) with its
 * placeholders filled from the snapshot. Null for a facts quote that holds a placeholder with no fact behind it, or cuts
 * one in half: it would show a brace, so it is dropped.
 */
// shortcut: a citation keeps its quote, not its offsets or claim flag; the profile (AIV-P1-043) finds the quote in the
// item's excerpt to highlight it. Carry start, end and claim through if that search proves wrong or slow.
export const citationOf = (
  source: ExplainSource,
  quote: string,
  values: Readonly<Record<string, string>>,
): ExplanationCitation | null => {
  if (source.id !== FACTS_ID) return { itemId: source.id, label: source.label, quote };
  const filled = resolve(quote, values);
  return filled === null || /[{}]/.test(filled) ? null : { itemId: null, label: source.label, quote: filled };
};

/**
 * The explanation without a model: the same facts in fixed words, each statement citing the line or excerpt it states.
 * Shown marked "Summary generated without AI" (AIV-P1-033).
 */
export function templateStatements(facts: Facts): ExplanationStatement[] {
  const factLines = facts.factsText?.split('\n') ?? [];
  const factSource: ExplainSource = { id: FACTS_ID, label: 'Snapshot', kind: 'facts', text: facts.factsText ?? '' };
  const statement = (template: string, citations: ExplanationCitation[]) => {
    const text = fill(template, facts.values);
    return text === null ? [] : [{ text, citations }];
  };
  const [first] = facts.items;
  const stated = (prefix: string) =>
    factLines.filter((l) => l.startsWith(prefix)).flatMap((l) => citationOf(factSource, l, facts.values) ?? []);
  return [
    ...statement(
      `{checkedCompetencies} carrying {checkedWeight} of the weight ${facts.counts.checked === 1 ? 'is' : 'are'} backed by work that was independently checked.`,
      stated('Independently'),
    ),
    ...(first
      ? [
          {
            text: `The cited work behind ${first.competency} is ${first.label}.`,
            citations: [{ itemId: first.id, label: first.label, quote: first.text }],
          },
        ]
      : []),
    ...statement(
      `{claimCompetencies} carrying {claimWeight} of the weight still ${facts.counts.claims === 1 ? 'rests' : 'rest'} on claims: {claimNames}.`,
      stated('Still'),
    ),
  ];
}

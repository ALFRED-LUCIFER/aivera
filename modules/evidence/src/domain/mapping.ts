// Evidence mapped to a job's competencies (AIV-P1-027): the deterministic guards after the model. Pure. The model only
// suggests a strength; these rules decide what is stored, and the lowest applicable cap wins. A gap is never negative
// evidence: it lowers nothing and is never a reason to reject (AGENTS.md 1.6).
import { strengthCapOf, type AuthorshipClass } from './repository.ts';
import type { Provenance, SourceKind, Strength } from './evidence.ts';
import type { Citation, GradeReason, SkillGrade } from './skill-signals/classify.ts';

const RANK: Record<Strength, number> = { claim: 0, supporting: 1, medium: 2, strong: 3 };
const lowest = (...strengths: Strength[]) =>
  strengths.reduce((a, b) => (RANK[b] < RANK[a] ? b : a), 'strong' as Strength);

export const CLAIM_LIMIT = 'A claim until a document or a second source supports it.';
export const OWN_ACCOUNT_LIMIT = "The candidate's own account: a claim until a second, independent source supports it.";

/**
 * Each source kind other than a repository or a CV (AIV-P1-087), so a new kind cannot be added without a decision:
 * `cap`, the strongest it can back: nobody else can inspect how a document, a submission or a page the candidate
 * published was made, and a reference call or an interview note is an indirect signal (the Rubric page's Supporting);
 * `ownAccount`, written by the candidate, so alone it is a claim. Neither these nor an interview note is independent
 * of the candidate; only a reference call is (`isIndependent` in corroboration.ts). A CV is a claim by the claim rule.
 */
const KINDS: Record<Exclude<SourceKind, 'repository' | 'cv'>, { cap: Strength; ownAccount: boolean }> = {
  document: { cap: 'medium', ownAccount: true },
  shipped_product: { cap: 'medium', ownAccount: true },
  portal_submission: { cap: 'medium', ownAccount: true },
  reference_call: { cap: 'supporting', ownAccount: false },
  interview_note: { cap: 'supporting', ownAccount: false },
};

/** The highest level 0–5 a link can show under each ceiling: expert needs Strong; an indirect signal shows 2 at most. */
// shortcut: a first calibration of level against strength; revisit it with the pilot's rubric reviews.
const LEVEL_CAP: Record<Strength, number> = { strong: 5, medium: 4, supporting: 2, claim: 1 };

/** One of the candidate's sources as the model saw it. */
export type MapSource = {
  id: string;
  kind: SourceKind;
  /** The repository read's authorship class; null when nothing was measured (or not a repository). */
  authorship: AuthorshipClass | null;
  /** Whether the repository read matched commits by a GitHub login the candidate supplied; false for other kinds. */
  hasLogin: boolean;
  /** Spans of the text the model saw that are declaration-level skill signals only (a manifest, a README, tests/). */
  declarationSpans: { start: number; end: number }[];
};

/** A repository source's skill grade for one competency of the rubric version (AIV-P1-072). */
export type MapGrade = {
  sourceId: string;
  competencyId: string;
  grade: SkillGrade;
  reason: GradeReason;
  filesInspected: number;
};

/** One link the model suggested, after the citation contract checked its quotes. */
export type ModelLink = {
  competencyId: string;
  strength: Strength;
  label: 'submitted' | 'claim';
  level: number;
  limit: string;
  citations: { sourceId: string; quote: string; start: number; end: number }[];
};

export type MappedLink = {
  competencyId: string;
  sourceId: string;
  excerpt: string;
  start: number;
  end: number;
  strength: Strength;
  provenance: Provenance;
  level: number;
  limit: string;
  /** The lowest cap the guards found; below Strong, the link has headroom "What would change this" can name. */
  ceiling: Strength;
};

/** Why a suggested link was not stored. `claim_above_supporting` and `unknown_competency` are guard failures. */
export type DiscardReason = 'unknown_competency' | 'unknown_source' | 'claim_above_supporting' | 'no_evidence_grade';

/** A skill grade's ceiling (the ticket's table); null for NO_EVIDENCE and UNABLE_TO_VERIFY: no link, a gap. */
export function gradeCap(grade: SkillGrade, reason: GradeReason): Strength | null {
  if (grade === 'STRONG') return 'strong';
  if (grade === 'PARTIAL') return reason === 'single_code_file' ? 'medium' : 'supporting';
  return null;
}

const within = (spans: readonly { start: number; end: number }[], start: number, end: number) =>
  spans.some((s) => s.start <= start && end <= s.end);

/**
 * The guards, per cited span (a link citing two sources is two links, each judged by its own source): competency
 * membership; a CV-sourced link above Supporting rejected, never lowered; a claim capped at Supporting; authorship,
 * login, skill-signal and declaration caps on repositories; a cap per other kind (KINDS); the level capped by the
 * source's caps (LEVEL_CAP); and never "Independently corroborated", which only AIV-P1-029 sets.
 */
export function guardLinks(input: {
  competencyIds: readonly string[];
  sources: readonly MapSource[];
  grades: readonly MapGrade[];
  links: readonly ModelLink[];
}): { links: MappedLink[]; discarded: { competencyId: string; reason: DiscardReason }[] } {
  const sources = new Map(input.sources.map((s) => [s.id, s]));
  const kept: MappedLink[] = [];
  const discarded: { competencyId: string; reason: DiscardReason }[] = [];
  for (const link of input.links)
    for (const citation of link.citations) {
      const discard = (reason: DiscardReason) => discarded.push({ competencyId: link.competencyId, reason });
      if (!input.competencyIds.includes(link.competencyId)) {
        discard('unknown_competency');
        continue;
      }
      const source = sources.get(citation.sourceId);
      if (!source) {
        discard('unknown_source');
        continue;
      }
      const cv = source.kind === 'cv';
      // The model has no reason to rate a CV line above Supporting unless it obeyed text in the CV.
      if (cv && RANK[link.strength] > RANK.supporting) {
        discard('claim_above_supporting');
        continue;
      }
      const claim = cv || link.label === 'claim';
      const caps: Strength[] = [];
      if (source.kind === 'repository') {
        // Unmeasured authorship (a merged pull request's upstream), or no GitHub login, is "authorship unclear".
        caps.push(source.authorship ? strengthCapOf(source.authorship, source.hasLogin) : 'medium');
        const grades = input.grades.filter((g) => g.sourceId === source.id && g.competencyId === link.competencyId);
        if (grades.length) {
          const best = grades.map((g) => gradeCap(g.grade, g.reason)).filter((c): c is Strength => c !== null);
          if (!best.length) {
            discard('no_evidence_grade');
            continue;
          }
          caps.push(best.reduce((a, b) => (RANK[b] > RANK[a] ? b : a)));
        }
        if (within(source.declarationSpans, citation.start, citation.end)) caps.push('supporting');
      } else if (source.kind !== 'cv') caps.push(KINDS[source.kind].cap);
      const ceiling = lowest(...caps, ...(claim ? (['supporting'] as const) : []));
      const duplicate = kept.some(
        (k) => k.competencyId === link.competencyId && k.sourceId === source.id && k.start === citation.start,
      );
      if (duplicate) continue;
      kept.push({
        competencyId: link.competencyId,
        sourceId: source.id,
        excerpt: citation.quote,
        start: citation.start,
        end: citation.end,
        strength: lowest(link.strength, ceiling),
        provenance: claim ? 'claim' : 'submitted',
        // A claim's level is what it claims and counts only toward "up to N if claims hold": source caps bound it, not
        // the claim cap. Any other link's level is bounded by the strength it is stored at.
        level: Math.min(link.level, LEVEL_CAP[claim ? lowest(...caps) : lowest(link.strength, ceiling)]),
        limit: claim ? CLAIM_LIMIT : link.limit,
        ceiling,
      });
    }
  return { links: kept, discarded };
}

/**
 * Provenance once corroboration is known (AIV-P1-029, AIV-P1-087): a Candidate-submitted link on a corroborated
 * competency becomes "Independently corroborated"; otherwise one from the candidate's own account is a claim, at most
 * Supporting, so it counts zero in the backed score and only widens "up to N if claims hold" (AGENTS.md 1.6).
 */
export function settleProvenance<
  L extends Pick<MappedLink, 'competencyId' | 'sourceId' | 'provenance' | 'strength' | 'limit'>,
>(links: readonly L[], sources: readonly Pick<MapSource, 'id' | 'kind'>[], corroborated: ReadonlySet<string>): L[] {
  const kinds = new Map(sources.map((s) => [s.id, s.kind]));
  return links.map((l) => {
    if (l.provenance !== 'submitted') return l;
    const kind = kinds.get(l.sourceId);
    // SAFETY: an interviewer's note or summary is one person's word about the candidate: other sources on the
    // competency never make it "Independently corroborated" (AGENTS.md 1.6, AIV-P1-115).
    if (corroborated.has(l.competencyId) && kind !== 'interview_note') return { ...l, provenance: 'corroborated' };
    if (!kind || kind === 'repository' || kind === 'cv' || !KINDS[kind].ownAccount) return l;
    return { ...l, provenance: 'claim', strength: lowest(l.strength, 'supporting'), limit: OWN_ACCOUNT_LIMIT };
  });
}

export const GAP_KINDS = ['not_found', 'unable_to_verify', 'no_evidence'] as const;
export type GapKind = (typeof GAP_KINDS)[number];

/** A competency nothing backs for the rubric version: evidence to request, never negative evidence. */
export type EvidenceGap = {
  competencyId: string;
  kind: GapKind;
  /** The repository scan's coverage behind the kind; null for `no_evidence`. */
  coverage: { filesInspected: number; reason: GradeReason } | null;
};

/**
 * Every rubric competency with no stored link is a gap: `unable_to_verify` when a repository could not check it,
 * `not_found` when a complete scan found nothing, otherwise `no_evidence`.
 */
export function findGaps(
  competencyIds: readonly string[],
  links: readonly Pick<MappedLink, 'competencyId'>[],
  grades: readonly MapGrade[],
): EvidenceGap[] {
  return competencyIds
    .filter((id) => !links.some((l) => l.competencyId === id))
    .map((competencyId) => {
      const own = grades.filter((g) => g.competencyId === competencyId);
      const grade =
        own.find((g) => g.grade === 'UNABLE_TO_VERIFY') ?? own.find((g) => g.grade === 'NO_EVIDENCE') ?? null;
      if (!grade) return { competencyId, kind: 'no_evidence', coverage: null };
      return {
        competencyId,
        kind: grade.grade === 'UNABLE_TO_VERIFY' ? 'unable_to_verify' : 'not_found',
        coverage: { filesInspected: grade.filesInspected, reason: grade.reason },
      };
    });
}

export const MAX_CHANGES = 3;

/** What one "What would change this" item closes: a gap or a capped link, by its index in the stored lists. */
export type ChangeTarget = { gap: number } | { link: number };

/** A stored "What would change this" item: the gap or the capped item it closes, by id. */
export type StoredChange = {
  competencyId: string;
  closes: { gapId: string } | { itemId: string };
  text: string | null;
};

/**
 * "What would change this": up to 3 checks, each closing a gap or a capped link (ceiling below Strong) of a rubric
 * competency. The model's items that close nothing are discarded (counted as citation failures). Ordered by
 * competency weight times headroom (how far the cap sits below Strong), ties in rubric order. Empty only when nothing
 * is left to close: a target the model named no check for is kept with `text: null`, for AIV-P1-038 to word.
 */
export function rankChanges(input: {
  competencies: readonly { id: string; weight: number }[];
  gaps: readonly Pick<EvidenceGap, 'competencyId'>[];
  links: readonly Pick<MappedLink, 'competencyId' | 'ceiling'>[];
  suggested: readonly { competencyId: string; text: string }[];
}): { changes: { competencyId: string; closes: ChangeTarget; text: string | null }[]; uncited: number } {
  const order = (id: string) => input.competencies.findIndex((c) => c.id === id);
  const weight = (id: string) => input.competencies[order(id)]?.weight ?? 0;
  const targets = input.competencies.flatMap(({ id }) => {
    const gap = input.gaps.findIndex((g) => g.competencyId === id);
    if (gap >= 0) return [{ competencyId: id, closes: { gap } as ChangeTarget, score: weight(id) * RANK.strong }];
    const capped = input.links
      .map((l, i) => ({ ...l, i }))
      .filter((l) => l.competencyId === id && RANK[l.ceiling] < RANK.strong)
      .toSorted((a, b) => RANK[a.ceiling] - RANK[b.ceiling])[0];
    return capped
      ? [
          {
            competencyId: id,
            closes: { link: capped.i } as ChangeTarget,
            score: weight(id) * (3 - RANK[capped.ceiling]),
          },
        ]
      : [];
  });
  const texts = new Map<string, string>();
  let uncited = 0;
  for (const s of input.suggested)
    if (!targets.some((t) => t.competencyId === s.competencyId)) uncited++;
    else if (!texts.has(s.competencyId)) texts.set(s.competencyId, s.text);
  const changes = targets
    .toSorted((a, b) => b.score - a.score || order(a.competencyId) - order(b.competencyId))
    .slice(0, MAX_CHANGES)
    .map(({ competencyId, closes }) => ({ competencyId, closes, text: texts.get(competencyId) ?? null }));
  return { changes, uncited };
}

/**
 * The text the model sees for one source: its label, its items' excerpts, then a repository's skill grades and their
 * file citations as measured facts, one per line. Returns the spans that show no use on their own: the label, grade
 * lines below STRONG and declaration-level citation lines.
 */
export function sourceText(
  label: string,
  excerpts: readonly string[],
  grades: readonly { skill: string; grade: SkillGrade; reason: GradeReason; citations: readonly Citation[] }[],
): { text: string; declarationSpans: { start: number; end: number }[] } {
  // The label (a repository name the candidate chose) shows nothing by itself: quoting it caps like a declaration.
  let text = [label, ...excerpts].join('\n');
  const declarationSpans: { start: number; end: number }[] = [{ start: 0, end: label.length }];
  const line = (value: string, declaration: boolean) => {
    text += '\n';
    if (declaration) declarationSpans.push({ start: text.length, end: text.length + value.length });
    text += value;
  };
  // One grade per skill: a skill two competencies share is graded the same against the same signals.
  for (const g of new Map(grades.map((one) => [one.skill, one])).values()) {
    // A grade line below STRONG says the skill was declared or not found: never more than Supporting when quoted.
    line(`Skill signal ${g.skill}: ${g.grade} (${g.reason})`, g.grade !== 'STRONG');
    for (const c of g.citations)
      line(`${g.skill} in ${c.path} (${c.kind}, ${c.weight}): ${c.detail}`, c.weight === 'declaration');
  }
  return { text, declarationSpans };
}
